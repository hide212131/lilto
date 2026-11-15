import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isHeartbeatAssistantSessionId } from "../shared/heartbeat-assistant";
import { createLogger, type Logger } from "./logger";

const SCHEMA_VERSION = 1;

type StoreFile = { schemaVersion: number; namespaces: Record<string, string[]> };

export type SessionPinStoreIo = {
  readFile(filePath: string): Promise<string | null>;
  /** Replaces the file atomically (temp file in the same directory, then rename). */
  writeFileAtomic(filePath: string, content: string): Promise<void>;
};

const defaultIo: SessionPinStoreIo = {
  async readFile(filePath) {
    try {
      return await fs.promises.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async writeFileAtomic(filePath, content) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.promises.open(temp, "w");
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.promises.rename(temp, filePath);
    } catch (error) {
      await fs.promises.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }
};

/** Namespace key: different (Codex Home, workspace) pairs must never share pin records. Windows lowercases both. */
export function buildSessionPinNamespace(codexHomeDir: string, workspaceDir: string): string {
  const normalize = (dir: string) => {
    const resolved = path.resolve(dir);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return JSON.stringify([normalize(codexHomeDir), normalize(workspaceDir)]);
}

export type SessionPinSaveResult =
  | { ok: true; isPinned: boolean }
  | { ok: false; error: { code: string; message: string } };

export type SessionPinCleanupResult =
  | { ok: true }
  | { ok: true; warning: { code: string; message: string } };

function saveFailure(error: unknown): SessionPinSaveResult {
  return { ok: false, error: { code: "SESSION_PIN_SAVE_FAILED", message: error instanceof Error ? error.message : String(error) } };
}

/**
 * Per-(Codex Home, workspace) set of pinned backend thread IDs. Owned by the single main process:
 * every mutation (read current -> compute next -> atomic write -> commit to memory) runs through one
 * serial queue, so two concurrent setPinned calls can never silently lose one another's update.
 * Holds no conversation text: just IDs.
 */
export class SessionPinStore {
  private readonly io: SessionPinStoreIo;
  private readonly logger: Logger;
  private data: StoreFile = { schemaVersion: SCHEMA_VERSION, namespaces: {} };
  private loading: Promise<void> | null = null;
  private loadFailed = false;
  private opChain: Promise<unknown> = Promise.resolve();
  /** IDs whose archive/delete-time unpin failed to persist; retried on the next store access. */
  private readonly pendingRemovals = new Map<string, Set<string>>();

  constructor(private readonly options: { filePath: string; io?: SessionPinStoreIo; logger?: Logger }) {
    this.io = options.io ?? defaultIo;
    this.logger = options.logger ?? createLogger("session-pin-store");
  }

  async ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    await this.loading;
  }

  async getPinnedIds(namespace: string): Promise<ReadonlySet<string>> {
    await this.ensureLoaded();
    await this.retryPendingRemovals(namespace);
    const ids = new Set(this.data.namespaces[namespace] ?? []);
    for (const id of this.pendingRemovals.get(namespace) ?? []) ids.delete(id);
    return ids;
  }

  async isPinned(namespace: string, threadId: string): Promise<boolean> {
    if (isHeartbeatAssistantSessionId(threadId)) return false;
    const ids = await this.getPinnedIds(namespace);
    return ids.has(threadId);
  }

  /** `desired` is the wished-for state, not a toggle: resending the same desired state is idempotent. */
  async setPinned(namespace: string, threadId: string, desired: boolean): Promise<SessionPinSaveResult> {
    if (typeof threadId !== "string" || !threadId.trim() || isHeartbeatAssistantSessionId(threadId)) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "対象の会話を特定できません" } };
    }
    await this.ensureLoaded();
    if (this.loadFailed) {
      return { ok: false, error: { code: "SESSION_PIN_SAVE_FAILED", message: "ピン情報を読み込めないため保存できません" } };
    }
    return this.queueOp(() => this.applySetPinned(namespace, threadId, desired));
  }

  /** Called after a backend archive/delete succeeds. Never retries the backend; only reports save failure as a warning. */
  async removePinOnSuccess(namespace: string, threadId: string): Promise<SessionPinCleanupResult> {
    await this.ensureLoaded();
    await this.retryPendingRemovals(namespace);
    if (this.loadFailed) {
      this.markPendingRemoval(namespace, threadId);
      return { ok: true, warning: { code: "SESSION_PIN_CLEANUP_FAILED", message: "ピン情報を読み込めないため保存できません" } };
    }
    const result = await this.queueOp(() => this.applySetPinned(namespace, threadId, false));
    if (result.ok) return { ok: true };
    this.markPendingRemoval(namespace, threadId);
    return { ok: true, warning: { code: "SESSION_PIN_CLEANUP_FAILED", message: result.error.message } };
  }

  private markPendingRemoval(namespace: string, threadId: string): void {
    const set = this.pendingRemovals.get(namespace) ?? new Set<string>();
    set.add(threadId);
    this.pendingRemovals.set(namespace, set);
  }

  private async retryPendingRemovals(namespace: string): Promise<void> {
    const ids = this.pendingRemovals.get(namespace);
    if (!ids || ids.size === 0 || this.loadFailed) return;
    for (const id of [...ids]) {
      const result = await this.queueOp(() => this.applySetPinned(namespace, id, false));
      if (result.ok) ids.delete(id);
    }
    if (ids.size === 0) this.pendingRemovals.delete(namespace);
  }

  private queueOp<T>(op: () => Promise<T>): Promise<T> {
    const result = this.opChain.then(op, op);
    this.opChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async applySetPinned(namespace: string, threadId: string, desired: boolean): Promise<SessionPinSaveResult> {
    const current = new Set(this.data.namespaces[namespace] ?? []);
    if (desired) current.add(threadId);
    else current.delete(threadId);
    const previous = this.data;
    this.data = { ...this.data, namespaces: { ...this.data.namespaces, [namespace]: [...current].sort() } };
    try {
      await this.io.writeFileAtomic(this.options.filePath, `${JSON.stringify(this.data)}\n`);
      return { ok: true, isPinned: desired };
    } catch (error) {
      this.data = previous;
      this.logger.error("session_pin_save_failed", { message: error instanceof Error ? error.message : String(error) });
      return saveFailure(error);
    }
  }

  private async load(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.io.readFile(this.options.filePath);
    } catch (error) {
      this.loadFailed = true;
      this.logger.error("session_pin_read_failed", { message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (raw === null) return; // Missing file: empty and healthy, not a failure.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.loadFailed = true;
      this.logger.error("session_pin_corrupt");
      return;
    }
    const obj = parsed as { schemaVersion?: unknown; namespaces?: unknown } | null;
    if (!obj || typeof obj !== "object" || obj.schemaVersion !== SCHEMA_VERSION
      || !obj.namespaces || typeof obj.namespaces !== "object" || Array.isArray(obj.namespaces)) {
      this.loadFailed = true;
      this.logger.error("session_pin_unsupported_schema");
      return;
    }
    const namespaces: Record<string, string[]> = {};
    for (const [namespace, value] of Object.entries(obj.namespaces as Record<string, unknown>)) {
      if (!Array.isArray(value)) {
        this.logger.error("session_pin_invalid_namespace_record", { namespace });
        continue;
      }
      const ids = value.filter((id): id is string =>
        typeof id === "string" && id.trim().length > 0 && !isHeartbeatAssistantSessionId(id));
      namespaces[namespace] = [...new Set(ids)].sort();
    }
    this.data = { schemaVersion: SCHEMA_VERSION, namespaces };
  }
}
