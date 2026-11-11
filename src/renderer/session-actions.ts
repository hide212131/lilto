import { isHeartbeatAssistantSessionId } from "../shared/heartbeat-assistant.js";
import type { SchedulerScheduleSummary } from "../shared/scheduler.js";
import type { Session } from "./types.js";

export type SessionActionKind = "archive" | "delete";
export type SessionActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

const ACTION_LABEL: Record<SessionActionKind, string> = { archive: "アーカイブ", delete: "削除" };
const UNTITLED = "名称未設定の会話";
const MAX_TITLE_CODE_POINTS = 120;

/** Display-only title: collapse whitespace, fall back when empty, cap at 120 code points. */
export function formatSessionTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return UNTITLED;
  const points = Array.from(normalized);
  return points.length > MAX_TITLE_CODE_POINTS ? `${points.slice(0, MAX_TITLE_CODE_POINTS).join("")}…` : normalized;
}

export function deleteConfirmMessage(title: string): string {
  return `「${formatSessionTitle(title)}」を完全に削除しますか？\nこの会話は復元できません。`;
}

export function sessionActionFailureMessage(kind: SessionActionKind, title: string, reason: string, code: string): string {
  return `「${formatSessionTitle(title)}」を${ACTION_LABEL[kind]}できません: ${reason}（${code}）`;
}

export function hasScheduleReference(session: Session, schedules: SchedulerScheduleSummary[]): boolean {
  return schedules.some((schedule) => schedule.sessionId === session.id
    || (!!session.backendSessionId && schedule.sessionId === session.backendSessionId));
}

export interface SessionActionDeps {
  findSession(sessionId: string): Session | undefined;
  isRunning(sessionId: string): boolean;
  getSchedules(): SchedulerScheduleSummary[];
  refreshSchedules(): Promise<void>;
  confirm(message: string): boolean;
  invoke(kind: SessionActionKind, backendSessionId: string): Promise<SessionActionResult>;
  /** Shared post-processing after the backend succeeded. */
  onSuccess(session: Session): void;
  onFailure(message: string): void;
  clearFailure(): void;
  onBusyChange(busySessionIds: string[]): void;
  onCancelled(sessionId: string): void;
}

const backendIdOf = (session: Session) => session.backendSessionId ?? session.id;

/** Serialises archive/delete per session and remembers removed IDs so late list loads cannot revive them. */
export class SessionActionRunner {
  private readonly inFlight = new Set<string>();
  private readonly removed = new Set<string>();

  constructor(private readonly deps: SessionActionDeps) {}

  isBusy(sessionId: string): boolean {
    return this.inFlight.has(sessionId);
  }

  isRemoved(sessionId: string): boolean {
    return this.removed.has(sessionId);
  }

  async run(kind: SessionActionKind, sessionId: string): Promise<void> {
    const session = this.deps.findSession(sessionId);
    if (!session || this.removed.has(sessionId) || this.inFlight.has(sessionId)) return;
    if (isHeartbeatAssistantSessionId(session.id)) return;
    this.deps.clearFailure();
    this.inFlight.add(sessionId);
    this.deps.onBusyChange([...this.inFlight]);
    const fail = (code: string, reason: string) =>
      this.deps.onFailure(sessionActionFailureMessage(kind, session.title, reason, code));
    const busyReason = "この会話は実行中です。処理の完了または中断後に再試行してください。";
    try {
      if (this.deps.isRunning(sessionId)) return fail("CONVERSATION_BUSY", busyReason);
      if (hasScheduleReference(session, this.deps.getSchedules())) {
        // Settings may already have removed the schedule; re-fetch before rejecting on stale state.
        await this.deps.refreshSchedules();
        const latest = this.deps.findSession(sessionId);
        if (!latest) return fail("CONVERSATION_UNAVAILABLE", "対象の会話は一覧にありません");
        if (hasScheduleReference(latest, this.deps.getSchedules())) {
          return fail("CONVERSATION_HAS_SCHEDULES", "この会話に紐付くスケジュールがあります。設定の Schedules で削除してから再試行してください。");
        }
      }
      if (kind === "delete" && !this.deps.confirm(deleteConfirmMessage(session.title))) {
        this.deps.onCancelled(sessionId);
        return;
      }
      const target = this.deps.findSession(sessionId);
      if (!target) return fail("CONVERSATION_UNAVAILABLE", "対象の会話は一覧にありません");
      if (backendIdOf(target) !== backendIdOf(session)) {
        return fail("CONVERSATION_UNAVAILABLE", "会話が更新されました。もう一度操作してください。");
      }
      if (this.deps.isRunning(sessionId)) return fail("CONVERSATION_BUSY", busyReason);
      let result: SessionActionResult;
      try {
        result = await this.deps.invoke(kind, backendIdOf(target));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return fail(kind === "archive" ? "CONVERSATION_ARCHIVE_FAILED" : "CONVERSATION_DELETE_FAILED", reason);
      }
      if (!result.ok) return fail(result.error.code, result.error.message);
      this.removed.add(sessionId);
      try {
        this.deps.onSuccess(target);
      } catch (error) {
        // The backend already succeeded: never retry it, only report the partial cleanup failure.
        const reason = error instanceof Error ? error.message : String(error);
        this.deps.onFailure(`会話の${ACTION_LABEL[kind]}は完了しましたが、後処理に失敗しました: ${reason}`);
      }
    } finally {
      this.inFlight.delete(sessionId);
      this.deps.onBusyChange([...this.inFlight]);
    }
  }
}
