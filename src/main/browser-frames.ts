import { randomBytes } from "node:crypto";

import { BROWSER_LIMITS as L, BrowserError, type BrowserFrameInfo } from "../shared/browser";

/** The slice of Electron's WebFrameMain the controller needs (so tests can fake it). */
export type FrameLike = {
  readonly frameTreeNodeId: number;
  readonly processId: number;
  readonly routingId: number;
  readonly url: string;
  readonly origin: string;
  readonly name: string;
  readonly detached: boolean;
  readonly parent: FrameLike | null;
  readonly framesInSubtree: FrameLike[];
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
};

type Binding = {
  frameTreeNodeId: number;
  processId: number;
  routingId: number;
  generation: number;
  viewEpoch: number;
  ownershipEpoch: number;
  documentEpoch: number;
  issuedAt: number;
};

export type FrameContext = { viewEpoch: number; ownershipEpoch: number; documentEpoch: number };

const MAX_BINDINGS = 512;

export function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false; // "null" (opaque), "" etc.
  }
}

/**
 * Per-view frame bookkeeping. A frameId is an opaque Main-issued handle bound to
 * (view, ownership, top document, frame identity, frame document generation, issue time).
 * Names / URLs are never used to look a frame up again.
 *
 * Generation: Electron's frameTreeNodeId survives navigation and the WebFrameMain object follows
 * the new document, so neither identifies a document. We count navigation *starts* and commits
 * per frame; any bump invalidates the ids bound to the older generation.
 */
export class FrameTracker {
  private readonly generations = new Map<number, number>();
  private readonly bindings = new Map<string, Binding>();

  constructor(private readonly now: () => number = Date.now) {}

  generation(frameTreeNodeId: number): number {
    return this.generations.get(frameTreeNodeId) ?? 0;
  }

  bump(frameTreeNodeId: number): void {
    this.generations.set(frameTreeNodeId, this.generation(frameTreeNodeId) + 1);
  }

  /** Conservative: when the affected frame cannot be identified, every frame is considered changed. */
  bumpAll(root: FrameLike | null): void {
    for (const key of this.generations.keys()) this.bump(key);
    for (const frame of safeSubtree(root)) this.bump(frame.frameTreeNodeId);
    // Frames not yet seen get generation 0 -> 1 via the loop above; ids bound to unknown frames cannot exist.
  }

  /** did-start-navigation / did-frame-navigate / did-navigate-in-page all funnel here. */
  onNavigation(root: FrameLike | null, frame: { frameTreeNodeId?: number } | null | undefined, ids?: { processId: number; routingId: number }): void {
    if (frame && typeof frame.frameTreeNodeId === "number") {
      this.bump(frame.frameTreeNodeId);
      return;
    }
    if (ids) {
      const hit = safeSubtree(root).find((candidate) => candidate.processId === ids.processId && candidate.routingId === ids.routingId);
      if (hit) {
        this.bump(hit.frameTreeNodeId);
        return;
      }
    }
    this.bumpAll(root);
  }

  /** Forget everything (view replaced / closed / ownership ended). */
  clear(): void {
    this.bindings.clear();
  }

  private prune(): void {
    const cutoff = this.now() - L.frameIdTtlMs;
    for (const [id, binding] of this.bindings) if (binding.issuedAt < cutoff) this.bindings.delete(id);
    while (this.bindings.size >= MAX_BINDINGS) {
      const oldest = this.bindings.keys().next().value;
      if (oldest === undefined) break;
      this.bindings.delete(oldest);
    }
  }

  /** Issue an id for a frame at its current generation. */
  issue(frame: FrameLike, context: FrameContext): string {
    this.prune();
    const frameId = `f${randomBytes(9).toString("base64url")}`;
    this.bindings.set(frameId, {
      frameTreeNodeId: frame.frameTreeNodeId,
      processId: frame.processId,
      routingId: frame.routingId,
      generation: this.generation(frame.frameTreeNodeId),
      ...context,
      issuedAt: this.now()
    });
    return frameId;
  }

  /** Build the public frame list for the current tree (bounded by count and bytes). */
  list(root: FrameLike, context: FrameContext): { frames: BrowserFrameInfo[]; truncated: boolean } {
    const frames: BrowserFrameInfo[] = [];
    const idByNode = new Map<number, string>();
    let bytes = 2;
    let truncated = false;
    for (const frame of safeSubtree(root)) {
      if (frames.length >= L.frameListMax) {
        truncated = true;
        break;
      }
      let info: Omit<BrowserFrameInfo, "frameId" | "parentFrameId">;
      try {
        const origin = frame.origin;
        const evaluable = !frame.detached && isHttpOrigin(origin);
        info = {
          url: clip(frame.url, L.frameUrlMaxChars),
          origin: clip(origin, L.frameUrlMaxChars),
          name: clip(frame.name, L.frameNameMaxChars),
          isMainFrame: frame.parent === null,
          evaluable,
          ...(evaluable ? {} : { unsupportedReason: frame.detached ? "detached" : isOpaque(origin) ? "opaque origin" : "non-http(s) origin" })
        };
      } catch {
        continue; // frame disposed while listing
      }
      const parentNode = frame.parent?.frameTreeNodeId;
      const entry: BrowserFrameInfo = {
        frameId: "",
        parentFrameId: parentNode === undefined ? null : idByNode.get(parentNode) ?? null,
        ...info
      };
      const size = Buffer.byteLength(JSON.stringify({ ...entry, frameId: "f".padEnd(14, "x") }), "utf8") + 1;
      if (bytes + size > L.frameListMaxBytes) {
        truncated = true;
        break;
      }
      bytes += size;
      entry.frameId = this.issue(frame, context);
      idByNode.set(frame.frameTreeNodeId, entry.frameId);
      frames.push(entry);
    }
    return { frames, truncated };
  }

  /**
   * Resolve an id to the live frame, or throw STALE_FRAME / UNSUPPORTED_TARGET (effect none).
   * Verified against the *current* tree of `root` only, so another view's frame can never match.
   */
  resolve(frameId: string, root: FrameLike, context: FrameContext): { frame: FrameLike; generation: number } {
    const stale = (why: string) => new BrowserError("STALE_FRAME", `The frame is no longer valid (${why}); take a new browser_snapshot`, { effect: "none" });
    const binding = this.bindings.get(frameId);
    if (!binding) throw stale("unknown id");
    if (this.now() - binding.issuedAt > L.frameIdTtlMs) {
      this.bindings.delete(frameId);
      throw stale("expired");
    }
    if (binding.viewEpoch !== context.viewEpoch || binding.ownershipEpoch !== context.ownershipEpoch || binding.documentEpoch !== context.documentEpoch) {
      throw stale("the page or ownership changed");
    }
    if (binding.generation !== this.generation(binding.frameTreeNodeId)) throw stale("the frame navigated");
    const frame = safeSubtree(root).find((candidate) => candidate.frameTreeNodeId === binding.frameTreeNodeId);
    if (!frame) throw stale("the frame was removed");
    try {
      if (frame.detached) throw stale("the frame was detached");
      if (frame.processId !== binding.processId || frame.routingId !== binding.routingId) throw stale("the frame was replaced");
      if (!isHttpOrigin(frame.origin)) {
        throw new BrowserError("UNSUPPORTED_TARGET", "Only frames with an http(s) origin can run scripts", { effect: "none" });
      }
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw stale("the frame was disposed");
    }
    return { frame, generation: binding.generation };
  }
}

function safeSubtree(root: FrameLike | null): FrameLike[] {
  if (!root) return [];
  try {
    return root.framesInSubtree;
  } catch {
    return [];
  }
}

function clip(value: string, max: number): string {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isOpaque(origin: string): boolean {
  return origin === "null" || origin === "";
}
