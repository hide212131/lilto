import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserInstructionState } from "./agent-sdk-config";
import { browserInstructionStatesEqual } from "./agent-sdk-config";
import { createLogger, type Logger } from "./logger";

const SCHEMA_VERSION = 1;

/**
 * confirmed: the model was told `confirmedState` and the turn that carried it completed normally.
 * pending:   a turn is in flight (or was, when the app died). Never trusted after a restart.
 * unknown:   nothing is known to be in effect (legacy thread, failure, interruption, compaction, corrupt record).
 */
export type BrowserInstructionRecord = {
  generation: number;
  status: "confirmed" | "pending" | "unknown";
  confirmedState?: BrowserInstructionState;
  pending?: { attemptId: string; intendedState: BrowserInstructionState; updateRequired: boolean };
};

export type BrowserInstructionAttempt = {
  namespace: string;
  threadId: string;
  attemptId: string;
  generation: number;
  /** True when the full text must ride on this turn (state unknown or different from the confirmed one). */
  sendUpdate: boolean;
  intendedState: BrowserInstructionState;
};

type StoreFile = { schemaVersion: number; namespaces: Record<string, Record<string, BrowserInstructionRecord>> };

export type BrowserInstructionStoreIo = {
  readFile(filePath: string): Promise<string | null>;
  /** Replaces the file atomically (temp file in the same directory, then rename). */
  writeFileAtomic(filePath: string, content: string): Promise<void>;
};

const defaultIo: BrowserInstructionStoreIo = {
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

function isState(value: unknown): value is BrowserInstructionState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.browser === "on" || v.browser === "off") && typeof v.evaluate === "boolean"
    && typeof v.instructionDigest === "string" && v.instructionDigest.length > 0;
}

/** Anything that is not a well-formed confirmed record reads back as unknown; never guess "already sent". */
function parseRecord(value: unknown): BrowserInstructionRecord {
  const generation = value && typeof value === "object" && Number.isInteger((value as { generation?: unknown }).generation)
    && (value as { generation: number }).generation >= 0 ? (value as { generation: number }).generation : 0;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.status === "confirmed" && isState(v.confirmedState)) {
      return { generation, status: "confirmed", confirmedState: v.confirmedState };
    }
  }
  return { generation, status: "unknown" };
}

/** Stable key for one Codex history base; different CODEX_HOMEs must never share records. */
export function browserInstructionNamespace(codexHomeDir: string): string {
  const resolved = path.resolve(codexHomeDir);
  const normalized = process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 32);
}

/**
 * Per-(Codex Home, thread) record of the browser state last announced to the model.
 * Owned by the single main process: every write is serialized and replaces the file atomically.
 * Holds no conversation text, tokens or page content.
 */
export class BrowserInstructionStateStore {
  private readonly io: BrowserInstructionStoreIo;
  private readonly logger: Logger;
  private data: StoreFile = { schemaVersion: SCHEMA_VERSION, namespaces: {} };
  private loading: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly occupied = new Set<string>();
  private readonly compactionInterrupts = new Map<string, number>();

  constructor(private readonly options: { filePath: string; io?: BrowserInstructionStoreIo; logger?: Logger }) {
    this.io = options.io ?? defaultIo;
    this.logger = options.logger ?? createLogger("browser-instruction-state");
  }

  /** Claims a whole turn on one backend thread. Returns null when another run already holds it. */
  tryAcquireThread(namespace: string, threadId: string): (() => void) | null {
    const key = `${namespace}\u0000${threadId}`;
    if (this.occupied.has(key)) return null;
    this.occupied.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.occupied.delete(key);
    };
  }

  /**
   * Decides whether this turn must carry the full text and persists a pending record BEFORE the turn is issued.
   * Throws when the record cannot be persisted: the caller must then not start the turn.
   */
  async begin(namespace: string, threadId: string, intendedState: BrowserInstructionState): Promise<BrowserInstructionAttempt> {
    await this.ensureLoaded();
    const previous = this.record(namespace, threadId);
    const sendUpdate = !(previous.status === "confirmed" && previous.confirmedState
      && browserInstructionStatesEqual(previous.confirmedState, intendedState));
    const attemptId = randomUUID();
    const next: BrowserInstructionRecord = {
      generation: previous.generation + 1,
      status: "pending",
      ...(previous.confirmedState && !sendUpdate ? { confirmedState: previous.confirmedState } : {}),
      pending: { attemptId, intendedState, updateRequired: sendUpdate }
    };
    this.setRecord(namespace, threadId, next);
    try {
      await this.persist();
    } catch (error) {
      this.setRecord(namespace, threadId, previous);
      throw new Error(`ブラウザ指示の送信状態を保存できませんでした: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { namespace, threadId, attemptId, generation: next.generation, sendUpdate, intendedState };
  }

  /** Normal completion. False (and the record stays non-confirmed) when superseded or when the save fails. */
  async confirm(attempt: BrowserInstructionAttempt): Promise<boolean> {
    const current = this.record(attempt.namespace, attempt.threadId);
    if (!this.owns(current, attempt) || current.status !== "pending") return false;
    this.setRecord(attempt.namespace, attempt.threadId, {
      generation: current.generation + 1,
      status: "confirmed",
      confirmedState: attempt.intendedState
    });
    try {
      await this.persist();
      return true;
    } catch (error) {
      // The file still says pending, which reads back as unknown: keep memory equally conservative.
      this.setRecord(attempt.namespace, attempt.threadId, { generation: current.generation + 1, status: "unknown" });
      this.logger.error("browser_instruction_confirm_save_failed", { message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Failure, interruption or compaction: nothing about this thread may be trusted any more.
   * Deliberately does not fall back to the previous confirmed state: an update may already have reached the model.
   */
  async markUnknown(attempt: BrowserInstructionAttempt): Promise<void> {
    const current = this.record(attempt.namespace, attempt.threadId);
    if (!this.owns(current, attempt)) return;
    this.setRecord(attempt.namespace, attempt.threadId, { generation: current.generation + 1, status: "unknown" });
    await this.persist().catch((error: unknown) => {
      // The persisted pending record already reads back as unknown.
      this.logger.error("browser_instruction_unknown_save_failed", { message: error instanceof Error ? error.message : String(error) });
    });
  }

  /**
   * In-memory only: how many consecutive turns on this thread were stopped at the START of a compaction
   * (which discards that compaction). Lets the adapter avoid stopping the same still-oversized thread forever.
   */
  getCompactionInterrupts(namespace: string, threadId: string): number {
    return this.compactionInterrupts.get(`${namespace}\u0000${threadId}`) ?? 0;
  }

  setCompactionInterrupts(namespace: string, threadId: string, count: number): void {
    const key = `${namespace}\u0000${threadId}`;
    if (count <= 0) this.compactionInterrupts.delete(key);
    else this.compactionInterrupts.set(key, count);
  }

  /** Read-only copy for diagnostics and tests. */
  peek(namespace: string, threadId: string): BrowserInstructionRecord {
    return structuredClone(this.record(namespace, threadId));
  }

  async ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    await this.loading;
  }

  private owns(current: BrowserInstructionRecord, attempt: BrowserInstructionAttempt): boolean {
    return current.pending?.attemptId === attempt.attemptId && current.generation === attempt.generation;
  }

  private record(namespace: string, threadId: string): BrowserInstructionRecord {
    return this.data.namespaces[namespace]?.[threadId] ?? { generation: 0, status: "unknown" };
  }

  private setRecord(namespace: string, threadId: string, record: BrowserInstructionRecord): void {
    (this.data.namespaces[namespace] ??= {})[threadId] = record;
  }

  private async load(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.io.readFile(this.options.filePath);
    } catch (error) {
      this.logger.error("browser_instruction_state_read_failed", { message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error("browser_instruction_state_corrupt");
      return;
    }
    const namespaces = (parsed as { namespaces?: unknown } | null)?.namespaces;
    if ((parsed as { schemaVersion?: unknown } | null)?.schemaVersion !== SCHEMA_VERSION || !namespaces || typeof namespaces !== "object") {
      this.logger.error("browser_instruction_state_unsupported_schema");
      return;
    }
    for (const [namespace, threads] of Object.entries(namespaces as Record<string, unknown>)) {
      if (!threads || typeof threads !== "object") continue;
      for (const [threadId, value] of Object.entries(threads as Record<string, unknown>)) {
        this.setRecord(namespace, threadId, parseRecord(value));
      }
    }
  }

  private persist(): Promise<void> {
    const job = async () => {
      await this.io.writeFileAtomic(this.options.filePath, `${JSON.stringify(this.data)}\n`);
    };
    const result = this.writeChain.then(job, job);
    this.writeChain = result.catch(() => {});
    return result;
  }
}
