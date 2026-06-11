import path from "node:path";
import { BrowserWindow } from "electron";

import { AgentRuntime } from "./agent-sdk";
import { ClaudeAuthService } from "./auth-service";
import { registerAppShortcut } from "./global-shortcut";
import { HeartbeatAssistantService } from "./heartbeat-assistant";
import { HeartbeatScheduler } from "./heartbeat";
import { createLogger, type Logger } from "./logger";
import { NotificationService } from "./notifications";
import { ProviderSettingsService } from "./provider-settings";
import { ModelCatalogService } from "./model-catalog";
import { CodexPluginService } from "./plugin-service";
import { SchedulerService, SchedulerUnavailableError } from "./scheduler";
import { SchedulerBridgeServer } from "./scheduler-bridge";
import { resolveCodexHomeDir, setupSkillRuntime, type SkillRuntimeSetup } from "./skill-runtime";
import { WindowsSandboxSetupService } from "./windows-sandbox-setup";
import { SpeechTranscriptionService } from "./speech-transcription";
import type { SchedulerNotificationEvent } from "../shared/scheduler";

type InitializeMainRuntimeOptions = {
  defaultWorkspaceDir: string;
  logger: Logger;
  notificationService: NotificationService;
  heartbeat: HeartbeatScheduler;
  userDataDir: string;
  broadcastSchedulerNotification: (event: SchedulerNotificationEvent) => void;
  mainWindow: () => BrowserWindow | null;
};

export type InitializedMainRuntime = {
  agentRuntime: AgentRuntime;
  authService: ClaudeAuthService;
  providerSettingsService: ProviderSettingsService;
  modelCatalogService: ModelCatalogService;
  pluginService: CodexPluginService;
  scheduler: SchedulerService;
  schedulerBridge: SchedulerBridgeServer;
  heartbeatAssistant: HeartbeatAssistantService;
  windowsSandboxSetupService: WindowsSandboxSetupService;
  speechTranscriptionService: SpeechTranscriptionService;
  skillRuntime: SkillRuntimeSetup;
};

function notifyForSchedulerEvent(
  notificationService: NotificationService,
  event: SchedulerNotificationEvent
): void {
  notificationService.notify("lilto - スケジュール通知", event.message, {
    onClick: () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isMinimized()) {
          window.restore();
        } else if (!window.isVisible()) {
          window.show();
        }
        window.focus();
        window.webContents.send("app:openConversation", event.sessionId);
      }
    }
  });
  notificationService.incrementBadge();
}

function initializeSkillRuntime(
  logger: Logger,
  userDataDir: string,
  defaultWorkspaceDir: string
): SkillRuntimeSetup {
  try {
    const skillRuntime = setupSkillRuntime({
      appDataDir: userDataDir,
      projectName: path.basename(defaultWorkspaceDir),
      projectRoot: defaultWorkspaceDir,
      workspaceTtlHours: Number(process.env.LILTO_WORKSPACE_TTL_HOURS || 24 * 7)
    });
    logger.info("skill_runtime_initialized", {
      appSkillsDir: skillRuntime.appSkillsDir,
      bundledSkillsDir: skillRuntime.bundledSkillsDir,
      userSkillsDir: skillRuntime.userSkillsDir,
      workspaceDir: skillRuntime.workspaceDir,
      skills: skillRuntime.availableSkills.map((skill) => skill.name),
      updatedSettings: skillRuntime.updatedSettings,
      removedWorkspaces: skillRuntime.removedWorkspaces
    });
    return skillRuntime;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("skill_runtime_init_failed", { message });
    return {
      appDataDir: userDataDir,
      codexHomeDir: process.env.CODEX_HOME || resolveCodexHomeDir(userDataDir),
      appSkillsDir: "",
      bundledSkillsDir: "",
      userSkillsDir: "",
      workspaceDir: defaultWorkspaceDir,
      availableSkills: [],
      updatedSettings: [],
      removedWorkspaces: []
    };
  }
}

export async function initializeMainRuntime({
  defaultWorkspaceDir,
  logger,
  notificationService,
  heartbeat,
  userDataDir,
  broadcastSchedulerNotification,
  mainWindow
}: InitializeMainRuntimeOptions): Promise<InitializedMainRuntime> {
  const providerSettingsService = new ProviderSettingsService({
    logger: createLogger("providers"),
    storagePath: path.join(userDataDir, "provider-settings.json")
  });
  const skillRuntime = initializeSkillRuntime(logger, userDataDir, defaultWorkspaceDir);

  let heartbeatAssistant: HeartbeatAssistantService | null = null;
  const scheduler = new SchedulerService({
    logger: createLogger("scheduler"),
    userDataDir,
    onNotification: (event) => {
      const shouldDeferVisibleNotification = Boolean(
        event.notificationDecisionCriteria && event.followUpInstruction
      );
      if (heartbeatAssistant) {
        void heartbeatAssistant.handleSchedulerNotification(event).then((handled) => {
          if (handled) {
            return;
          }
          broadcastSchedulerNotification(event);
          if (!shouldDeferVisibleNotification && BrowserWindow.getFocusedWindow() === null) {
            notifyForSchedulerEvent(notificationService, event);
          }
        });
        return;
      }
      broadcastSchedulerNotification(event);
      if (!shouldDeferVisibleNotification && BrowserWindow.getFocusedWindow() === null) {
        notifyForSchedulerEvent(notificationService, event);
      }
    }
  });
  void scheduler.start().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof SchedulerUnavailableError) {
      logger.info("scheduler_unavailable", { message });
      return;
    }
    logger.error("scheduler_start_failed", { message });
  });

  const schedulerBridge = new SchedulerBridgeServer({
    logger: createLogger("scheduler-bridge"),
    scheduler
  });
  await schedulerBridge.start().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("scheduler_bridge_start_failed", { message });
  });

  const authService = new ClaudeAuthService({
    logger: createLogger("auth"),
    authPath: path.join(userDataDir, "auth-state.json"),
    codexHome: skillRuntime.codexHomeDir,
    fallbackCodexHome: skillRuntime.codexHomeDir
  });
  const modelCatalogService = new ModelCatalogService({
    logger: createLogger("models"),
    codexHomeDir: skillRuntime.codexHomeDir
  });
  const pluginService = new CodexPluginService({
    logger: createLogger("plugins"),
    workspaceDir: skillRuntime.workspaceDir,
    homeDir: skillRuntime.appDataDir,
    codexHomeDir: skillRuntime.codexHomeDir
  });
  const windowsSandboxSetupService = new WindowsSandboxSetupService({
    logger: createLogger("windows-sandbox-setup"),
    codexHomeDir: skillRuntime.codexHomeDir,
    workspaceDir: skillRuntime.workspaceDir
  });
  const speechTranscriptionService = new SpeechTranscriptionService();

  const agentRuntime = new AgentRuntime({
    logger: createLogger("agent"),
    authService,
    workspaceDir: skillRuntime.workspaceDir,
    codexHomeDir: skillRuntime.codexHomeDir,
    schedulerBridge,
    availableSkills: skillRuntime.availableSkills
  });

  heartbeatAssistant = new HeartbeatAssistantService({
    logger: createLogger("heartbeat-assistant"),
    scheduler,
    agentRuntime,
    notificationService,
    userDataDir,
    getProviderSettings: () => {
      return providerSettingsService.getState();
    },
    broadcastNotification: broadcastSchedulerNotification,
    getFocusedWindow: () => BrowserWindow.getFocusedWindow()
  });
  void heartbeatAssistant.syncManagedSchedule(providerSettingsService.getState());

  const initialShortcut = providerSettingsService.getState().chatSettings.globalShortcut;
  registerAppShortcut(initialShortcut, mainWindow);
  heartbeat.start();

  return {
    agentRuntime,
    authService,
    providerSettingsService,
    modelCatalogService,
    pluginService,
    scheduler,
    schedulerBridge,
    heartbeatAssistant,
    windowsSandboxSetupService,
    speechTranscriptionService,
    skillRuntime
  };
}