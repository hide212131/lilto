import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { BrowserError, type BrowserOwnerView } from "../shared/browser";

/** Per-run capability issued by Main. The token is the only authentication root. */
export type BrowserRunContext = {
  runId: string;
  conversationId: string;
  requestId: string;
  token: string;
  policyRevision: number;
};

export type BrowserOwner =
  | { kind: "none" }
  | { kind: "user" }
  | { kind: "agent"; conversationId: string; requestId: string; runId: string; leaseId: string };

export type Epochs = { viewEpoch: number; documentEpoch: number; ownershipEpoch: number; interactionEpoch: number };

type RunRecord = BrowserRunContext & { revoked: boolean; interrupted: boolean; controller: AbortController };

/**
 * Pure bookkeeping for runs, leases and epochs. It owns no Electron objects so the
 * ownership contract (A/B conflicts, stale runs, user interruption) is unit-testable.
 */
export class BrowserOwnership {
  private owner: BrowserOwner = { kind: "none" };
  private readonly runsByToken = new Map<string, RunRecord>();
  private readonly runsById = new Map<string, RunRecord>();
  private lastOwnerConversationId: string | null = null;
  private leaseAbort: AbortController | null = null;
  private issuing = true;
  readonly epochs: Epochs = { viewEpoch: 0, documentEpoch: 0, ownershipEpoch: 0, interactionEpoch: 0 };
  onChange: (() => void) | null = null;

  getOwner(): BrowserOwner {
    return this.owner;
  }

  getLastOwnerConversationId(): string | null {
    return this.lastOwnerConversationId;
  }

  ownerView(): BrowserOwnerView {
    if (this.owner.kind === "none") return null;
    if (this.owner.kind === "user") return { kind: "user" };
    return { kind: "agent", conversationId: this.owner.conversationId };
  }

  /** Stop issuing new capabilities (settings OFF in progress). */
  setIssuing(allowed: boolean): void {
    this.issuing = allowed;
  }

  /** Issues a capability for one run. Throws BROWSER_DISABLED if issuing is stopped. */
  issueRun(input: { conversationId: string; requestId: string; policyRevision: number }): BrowserRunContext {
    if (!this.issuing) throw new BrowserError("BROWSER_DISABLED", "The embedded browser is disabled");
    const context: BrowserRunContext = {
      runId: randomUUID(),
      conversationId: input.conversationId,
      requestId: input.requestId,
      token: randomBytes(32).toString("hex"),
      policyRevision: input.policyRevision
    };
    const record: RunRecord = { ...context, revoked: false, interrupted: false, controller: new AbortController() };
    this.runsByToken.set(context.token, record);
    this.runsById.set(context.runId, record);
    return context;
  }

  /** Resolves a bearer token to its run (constant-time compare), or null when unknown/revoked. */
  resolveToken(token: string): { runId: string; conversationId: string; requestId: string; signal: AbortSignal } | null {
    const given = createHash("sha256").update(token).digest();
    let found: RunRecord | null = null;
    for (const [candidate, record] of this.runsByToken) {
      const equal = timingSafeEqual(given, createHash("sha256").update(candidate).digest());
      if (equal && !record.revoked) found = record;
    }
    if (!found) return null;
    return { runId: found.runId, conversationId: found.conversationId, requestId: found.requestId, signal: found.controller.signal };
  }

  isRunActive(runId: string): boolean {
    const record = this.runsById.get(runId);
    return Boolean(record && !record.revoked);
  }

  /** Revokes a run's token, aborts its in-flight work and frees a lease it held. */
  revokeRun(runId: string): void {
    const record = this.runsById.get(runId);
    if (!record) return;
    record.revoked = true;
    record.controller.abort();
    this.runsByToken.delete(record.token);
    this.runsById.delete(runId);
    if (this.owner.kind === "agent" && this.owner.runId === runId) this.releaseOwner();
  }

  revokeAllRuns(): void {
    for (const runId of [...this.runsById.keys()]) this.revokeRun(runId);
  }

  /** acquire per design 7.2. Returns the lease id and whether the caller already held it. */
  acquire(runId: string): { leaseId: string; reused: boolean } {
    const run = this.runsById.get(runId);
    if (!run || run.revoked) throw new BrowserError("CANCELLED", "The run is no longer active");
    if (run.interrupted) throw new BrowserError("USER_INTERRUPTED", "The user took over the browser during this run");
    const owner = this.owner;
    if (owner.kind === "agent" && owner.runId === runId) return { leaseId: owner.leaseId, reused: true };
    if (owner.kind === "agent") throw new BrowserError("BROWSER_BUSY", "Another conversation is using the browser");
    if (owner.kind === "user") throw new BrowserError("BROWSER_BUSY", "The user is controlling the browser");
    const leaseId = randomUUID();
    this.owner = { kind: "agent", conversationId: run.conversationId, requestId: run.requestId, runId, leaseId };
    this.leaseAbort = new AbortController();
    this.lastOwnerConversationId = run.conversationId;
    this.epochs.ownershipEpoch += 1;
    this.onChange?.();
    return { leaseId, reused: false };
  }

  /** Throws unless `leaseId` is the live lease held by a live run. */
  assertLease(runId: string, leaseId: string): void {
    const run = this.runsById.get(runId);
    if (!run || run.revoked) throw new BrowserError("CANCELLED", "The run is no longer active");
    if (run.interrupted) throw new BrowserError("USER_INTERRUPTED", "The user took over the browser during this run");
    const owner = this.owner;
    if (owner.kind === "none") throw new BrowserError("BROWSER_NOT_OWNED", "Call browser_acquire first");
    if (owner.kind === "user") throw new BrowserError("LEASE_EXPIRED", "The user took over the browser");
    if (owner.runId !== runId || owner.leaseId !== leaseId) throw new BrowserError("LEASE_EXPIRED", "The lease is not valid; acquire again");
  }

  /** Aborts when this lease ends for any reason (the run itself stays usable). */
  leaseSignal(runId: string, leaseId: string): AbortSignal {
    const owner = this.owner;
    if (owner.kind === "agent" && owner.runId === runId && owner.leaseId === leaseId && this.leaseAbort) return this.leaseAbort.signal;
    return AbortSignal.abort();
  }

  release(runId: string, leaseId: string): void {
    this.assertLease(runId, leaseId);
    this.releaseOwner();
  }

  /** User switches to manual control: revoke the agent lease; this run may not reacquire. */
  takeControl(): void {
    this.interruptAgentLease();
    if (this.owner.kind !== "user") {
      this.owner = { kind: "user" };
      this.epochs.ownershipEpoch += 1;
      this.epochs.interactionEpoch += 1;
      this.onChange?.();
    }
  }

  /** "Allow AI control": drop manual ownership so the next acquire can succeed. */
  allowAgentControl(): void {
    if (this.owner.kind === "user") {
      this.owner = { kind: "none" };
      this.epochs.ownershipEpoch += 1;
      this.onChange?.();
    }
  }

  /** Close, hide, window hide/minimize, crash: expire the lease without giving it to the user. */
  expireLease(options: { interrupted: boolean }): void {
    if (this.owner.kind !== "agent") return;
    if (options.interrupted) this.interruptAgentLease();
    else this.releaseOwner();
  }

  /** Modal/resizing: cancel in-flight work but keep the lease (it resumes after re-present). */
  bumpInteraction(): void {
    this.epochs.interactionEpoch += 1;
  }

  bumpDocument(): void {
    this.epochs.documentEpoch += 1;
  }

  bumpView(): void {
    this.epochs.viewEpoch += 1;
  }

  snapshotEpochs(): Epochs {
    return { ...this.epochs };
  }

  /** True when no epoch changed since `before` was captured. */
  unchanged(before: Epochs, keys: Array<keyof Epochs> = ["viewEpoch", "ownershipEpoch", "interactionEpoch", "documentEpoch"]): boolean {
    return keys.every((key) => this.epochs[key] === before[key]);
  }

  private interruptAgentLease(): void {
    const owner = this.owner;
    if (owner.kind !== "agent") return;
    const run = this.runsById.get(owner.runId);
    if (run) {
      run.interrupted = true;
      run.controller.abort();
    }
    this.releaseOwner();
  }

  private releaseOwner(): void {
    this.leaseAbort?.abort();
    this.leaseAbort = null;
    this.owner = { kind: "none" };
    this.epochs.ownershipEpoch += 1;
    this.epochs.interactionEpoch += 1;
    this.onChange?.();
  }
}

/** Single serial operation queue; every operation re-checks validity before running. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(private readonly maxPending = 8) {}

  get size(): number {
    return this.pending;
  }

  enqueue<T>(operation: () => Promise<T>, guard: () => void): Promise<T> {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new BrowserError("BROWSER_BUSY", "Too many pending browser operations", { retryable: true }));
    }
    this.pending += 1;
    const run = this.tail.then(async () => {
      guard();
      return operation();
    });
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.tail = settled.finally(() => {
      this.pending -= 1;
    });
    return run;
  }
}
