import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { AgentRuntime } from "./agent-sdk";
import type { Logger } from "./logger";
import type { NotificationService } from "./notifications";
import type { SchedulerClient } from "./scheduler";
import type { ProviderSettings } from "./provider-settings";
import {
  buildHeartbeatAssistantSessionId,
  HEARTBEAT_INTERNAL_SCHEDULE_ID,
  type HeartbeatAssistantStatus
} from "../shared/heartbeat-assistant";
import type { SchedulerNotificationEvent } from "../shared/scheduler";
import {
  DEFAULT_HEARTBEAT_CHECK_NAME,
  HEARTBEAT_NOTIFICATION_MESSAGE,
  HEARTBEAT_SCHEDULE_TITLE,
  HEARTBEAT_STATE_FILE,
  HEARTBEAT_TIMEZONE,
  LEGACY_HEARTBEAT_STATE_FILE,
  buildHeartbeatCronExpr,
  buildPromptStateSummary,
  defaultHeartbeatState,
  ensureDirectory,
  heartbeatDateKey,
  normalizeHeartbeatResponse,
  normalizeState,
  parseHeartbeatFinding,
  type HeartbeatPersistedState
} from "./heartbeat-assistant-helpers";

export function isHeartbeatInternalScheduleId(id: string): boolean {
  return id === HEARTBEAT_INTERNAL_SCHEDULE_ID;
}

export class HeartbeatAssistantService {
  private readonly logger: Logger;
  private readonly scheduler: SchedulerClient;
  private readonly agentRuntime: AgentRuntime;
  private readonly notificationService: NotificationService;
  private readonly getProviderSettings: () => ProviderSettings;
  private readonly broadcastNotification: (event: SchedulerNotificationEvent) => void;
  private readonly getFocusedWindow: () => BrowserWindow | null;
  private readonly stateFilePath: string;
  private readonly legacyStateFilePath: string;
  private lastStatus: HeartbeatAssistantStatus = {
    level: "disabled",
    message: "heartbeat assistant は無効です。",
    lastRunAt: null,
    lastFindingAt: null
  };

  constructor({
    logger,
    scheduler,
    agentRuntime,
    notificationService,
    userDataDir,
    getProviderSettings,
    broadcastNotification,
    getFocusedWindow
  }: {
    logger: Logger;
    scheduler: SchedulerClient;
    agentRuntime: AgentRuntime;
    notificationService: NotificationService;
    userDataDir: string;
    getProviderSettings: () => ProviderSettings;
    broadcastNotification: (event: SchedulerNotificationEvent) => void;
    getFocusedWindow: () => BrowserWindow | null;
  }) {
    this.logger = logger;
    this.scheduler = scheduler;
    this.agentRuntime = agentRuntime;
    this.notificationService = notificationService;
    this.getProviderSettings = getProviderSettings;
    this.broadcastNotification = broadcastNotification;
    this.getFocusedWindow = getFocusedWindow;
    this.stateFilePath = path.join(userDataDir, HEARTBEAT_STATE_FILE);
    this.legacyStateFilePath = path.join(userDataDir, LEGACY_HEARTBEAT_STATE_FILE);
  }

  getStatus(): HeartbeatAssistantStatus {
    return { ...this.lastStatus };
  }

  async syncManagedSchedule(settings: ProviderSettings): Promise<void> {
    const heartbeatSettings = settings.heartbeatSettings;
    try {
      const schedules = await this.scheduler.listSchedules();
      const existing = schedules.find((schedule) => isHeartbeatInternalScheduleId(schedule.id));
      if (!heartbeatSettings.enabled) {
        if (existing) {
          await this.scheduler.deleteSchedule(HEARTBEAT_INTERNAL_SCHEDULE_ID);
        }
        this.setStatus({
          level: "disabled",
          message: "heartbeat assistant は無効です。"
        });
        return;
      }

      const input = {
        id: HEARTBEAT_INTERNAL_SCHEDULE_ID,
        title: HEARTBEAT_SCHEDULE_TITLE,
        kind: "cron" as const,
        cronExpr: buildHeartbeatCronExpr(heartbeatSettings.intervalMinutes),
        timezone: HEARTBEAT_TIMEZONE,
        notification: {
          sessionId: HEARTBEAT_INTERNAL_SCHEDULE_ID,
          message: HEARTBEAT_NOTIFICATION_MESSAGE
        }
      };

      if (!existing) {
        await this.scheduler.createSchedule(input);
      } else if (
        existing.cronExpr !== input.cronExpr ||
        existing.notificationMessage !== input.notification.message ||
        existing.title !== input.title
      ) {
        await this.scheduler.updateSchedule(HEARTBEAT_INTERNAL_SCHEDULE_ID, input);
      }

      this.setStatus(this.describeConfigStatus(settings));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("heartbeat_schedule_sync_failed", { message });
      this.setStatus({ level: "error", message: `スケジュール同期に失敗しました: ${message}` });
    }
  }

  async handleSchedulerNotification(event: SchedulerNotificationEvent): Promise<boolean> {
    if (!isHeartbeatInternalScheduleId(event.id)) {
      return false;
    }

    await this.runPatrol();
    return true;
  }

  async runPatrol(): Promise<void> {
    const settings = this.getProviderSettings();
    const heartbeatSettings = settings.heartbeatSettings;
    const runAt = new Date();
    const runAtIso = runAt.toISOString();
    const runAtMs = runAt.getTime();
    const sessionId = this.getSessionIdForRun(runAt);
    if (!heartbeatSettings.enabled) {
      this.setStatus({ level: "disabled", message: "heartbeat assistant は無効です。" });
      return;
    }

    if (!heartbeatSettings.filePath.trim()) {
      this.updateState((state) => ({
        ...state,
        lastRunAt: runAtMs,
        lastOutcome: "missing_file",
        lastError: undefined
      }));
      this.setStatus({
        level: "missing-file",
        message: "HEARTBEAT.md の参照先が未設定です。"
      });
      return;
    }

    let heartbeatSource = "";
    try {
      heartbeatSource = fs.readFileSync(heartbeatSettings.filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateState((state) => ({
        ...state,
        lastRunAt: runAtMs,
        lastOutcome: "unreadable",
        lastError: message
      }));
      this.setStatus({
        level: "unreadable",
        message: `HEARTBEAT.md を読めません: ${message}`
      });
      return;
    }

    if (!heartbeatSource.trim()) {
      this.updateState((state) => ({
        ...state,
        lastChecks: {
          ...state.lastChecks,
          [DEFAULT_HEARTBEAT_CHECK_NAME]: runAtMs
        },
        lastRunAt: runAtMs,
        lastOutcome: "empty",
        lastError: undefined
      }));
      this.setStatus({
        level: "empty",
        message: "HEARTBEAT.md が空のため巡回をスキップしました。"
      });
      return;
    }

    const prompt = this.buildPrompt(heartbeatSource);
    const result = await this.agentRuntime.submitPrompt(prompt, settings, {
      requestId: `heartbeat-${Date.now()}`,
      conversationId: sessionId,
      freshContext: true,
      mode: "heartbeat"
    });

    if (!result.ok) {
      const message = `${result.error.code}: ${result.error.message}`;
      this.updateState((state) => ({
        ...state,
        lastRunAt: runAtMs,
        lastOutcome: "error",
        lastError: message
      }));
      this.setStatus({ level: "error", message: `heartbeat 巡回に失敗しました: ${message}` });
      return;
    }

    const normalized = normalizeHeartbeatResponse(result.text);
    if (!normalized || normalized === "HEARTBEAT_OK") {
      this.updateState((state) => ({
        ...state,
        lastChecks: {
          ...state.lastChecks,
          [DEFAULT_HEARTBEAT_CHECK_NAME]: runAtMs
        },
        lastRunAt: runAtMs,
        lastOutcome: "ok",
        lastError: undefined
      }));
      this.setStatus({
        level: "ok",
        message: "最後の巡回では問題はありませんでした。結果は配信していません。",
        lastRunAt: runAtIso
      });
      return;
    }

    const state = this.readState();
    const finding = parseHeartbeatFinding(result.text);
    const lastNotifiedAt = state.lastNotified[finding.findingKey] ?? null;

    this.updateState((current) => ({
      ...current,
      lastChecks: {
        ...current.lastChecks,
        [DEFAULT_HEARTBEAT_CHECK_NAME]: runAtMs,
        [finding.checkName]: runAtMs
      },
      lastNotified: lastNotifiedAt === null
        ? {
          ...current.lastNotified,
          [finding.findingKey]: runAtMs
        }
        : { ...current.lastNotified },
      lastRunAt: runAtMs,
      lastOutcome: "finding",
      lastError: undefined,
      lastFindingText: finding.message,
      lastFindingKey: finding.findingKey,
      lastFindingAt: runAtMs
    }));

    if (lastNotifiedAt !== null) {
      this.setStatus({
        level: "finding",
        message: "同じ finding のため再通知は抑制しました。",
        lastRunAt: runAtIso,
        lastFindingAt: new Date(lastNotifiedAt).toISOString()
      });
      return;
    }

    this.broadcastNotification({
      id: HEARTBEAT_INTERNAL_SCHEDULE_ID,
      sessionId,
      message: finding.message,
      firedAt: runAtIso
    });

    if (heartbeatSettings.showDesktopNotifications && this.getFocusedWindow() === null) {
      this.notificationService.notify("lilto - heartbeat assistant", finding.message);
      this.notificationService.incrementBadge();
    }

    this.setStatus({
      level: "finding",
      message: "対応が必要な finding を検出しました。",
      lastRunAt: runAtIso,
      lastFindingAt: runAtIso
    });
  }

  private getSessionIdForRun(at: Date): string {
    return buildHeartbeatAssistantSessionId(heartbeatDateKey(at));
  }

  private buildPrompt(heartbeatSource: string): string {
    const state = this.readState();
    return [
      "You are the heartbeat assistant for lilto.",
      "This run is report-only. Never execute sending, deleting, purchasing, or any other side-effecting action.",
      "Read the HEARTBEAT instructions below and inspect only enough context to decide whether the user needs attention.",
      "Do not infer stale unresolved work from old conversations.",
      "If everything is fine, respond with exactly HEARTBEAT_OK.",
      "If attention is needed, respond in plain text using exactly this format:",
      "KEY: <stable-key from the underlying source, for example calendar:event-abc123:2h-warning>",
      "CHECK: <check-name>",
      "MESSAGE: <short user-facing report>",
      "Use stable IDs when the underlying data provides them. Do not invent IDs.",
      `Current time: ${new Date().toISOString()}`,
      "Heartbeat state JSON:",
      buildPromptStateSummary(state),
      state.lastFindingText ? `Previous finding: ${state.lastFindingText}` : "Previous finding: none",
      "HEARTBEAT instructions:",
      heartbeatSource
    ].join("\n\n");
  }

  private describeConfigStatus(settings: ProviderSettings): HeartbeatAssistantStatus {
    if (!settings.heartbeatSettings.enabled) {
      return { level: "disabled", message: "heartbeat assistant は無効です。", lastRunAt: null, lastFindingAt: null };
    }
    if (!settings.heartbeatSettings.filePath.trim()) {
      return {
        level: "missing-file",
        message: "HEARTBEAT.md の参照先が未設定です。",
        lastRunAt: this.lastStatus.lastRunAt,
        lastFindingAt: this.lastStatus.lastFindingAt
      };
    }
    if (!fs.existsSync(settings.heartbeatSettings.filePath)) {
      return {
        level: "unreadable",
        message: "HEARTBEAT.md が見つかりません。",
        lastRunAt: this.lastStatus.lastRunAt,
        lastFindingAt: this.lastStatus.lastFindingAt
      };
    }
    return {
      level: "ready",
      message: `${settings.heartbeatSettings.intervalMinutes} 分ごとに巡回し、問題がある時だけ表面化します。`,
      lastRunAt: this.lastStatus.lastRunAt,
      lastFindingAt: this.lastStatus.lastFindingAt
    };
  }

  private readState(): HeartbeatPersistedState {
    try {
      const filePath = fs.existsSync(this.stateFilePath)
        ? this.stateFilePath
        : fs.existsSync(this.legacyStateFilePath)
          ? this.legacyStateFilePath
          : null;
      if (!filePath) {
        return defaultHeartbeatState();
      }
      return normalizeState(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("heartbeat_state_read_failed", { message });
      return defaultHeartbeatState();
    }
  }

  private updateState(mutator: (state: HeartbeatPersistedState) => HeartbeatPersistedState): void {
    const next = normalizeState(mutator(this.readState()));
    ensureDirectory(this.stateFilePath);
    fs.writeFileSync(this.stateFilePath, JSON.stringify(next, null, 2), "utf8");
  }

  private setStatus(status: Partial<HeartbeatAssistantStatus>): void {
    this.lastStatus = {
      ...this.lastStatus,
      ...status,
      lastRunAt: status.lastRunAt ?? this.lastStatus.lastRunAt,
      lastFindingAt: status.lastFindingAt ?? this.lastStatus.lastFindingAt
    };
  }
}