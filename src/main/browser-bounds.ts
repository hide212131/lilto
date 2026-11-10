import type { BrowserViewportUpdate } from "../shared/browser";

export type IntRect = { x: number; y: number; width: number; height: number };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Structural validation of an untrusted renderer message. */
export function parseViewportUpdate(input: unknown): BrowserViewportUpdate | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  const viewport = v.viewport as Record<string, unknown> | undefined;
  const host = v.hostViewport as Record<string, unknown> | undefined;
  if (typeof v.rendererEpoch !== "string" || !finite(v.seq) || !finite(v.layoutRevision)) return null;
  if (typeof v.panelOpen !== "boolean" || typeof v.occluded !== "boolean" || typeof v.resizing !== "boolean") return null;
  if (!viewport || !host) return null;
  if (![viewport.x, viewport.y, viewport.width, viewport.height, host.width, host.height].every(finite)) return null;
  return {
    rendererEpoch: v.rendererEpoch,
    seq: v.seq,
    layoutRevision: v.layoutRevision,
    viewport: { x: viewport.x as number, y: viewport.y as number, width: viewport.width as number, height: viewport.height as number },
    hostViewport: { width: host.width as number, height: host.height as number },
    panelOpen: v.panelOpen,
    occluded: v.occluded,
    resizing: v.resizing
  };
}

/**
 * CSS px -> DIP (host zoom only, never devicePixelRatio), clamped into the window
 * content area, rounded inward. Returns null when nothing visible remains.
 */
export function computeViewBounds(
  viewport: { x: number; y: number; width: number; height: number },
  zoomFactor: number,
  content: { width: number; height: number }
): IntRect | null {
  if (![viewport.x, viewport.y, viewport.width, viewport.height, zoomFactor, content.width, content.height].every(finite)) return null;
  if (zoomFactor <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const left = viewport.x * zoomFactor;
  const top = viewport.y * zoomFactor;
  const right = (viewport.x + viewport.width) * zoomFactor;
  const bottom = (viewport.y + viewport.height) * zoomFactor;
  const x0 = Math.max(0, Math.ceil(left));
  const y0 = Math.max(0, Math.ceil(top));
  const x1 = Math.min(Math.floor(content.width), Math.floor(right));
  const y1 = Math.min(Math.floor(content.height), Math.floor(bottom));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Accepts only in-order updates of the current renderer epoch and layout revision. */
export class ViewportGate {
  private lastSeq = -1;
  constructor(private rendererEpoch: string, private layoutRevision: number) {}

  reset(rendererEpoch: string, layoutRevision: number): void {
    this.rendererEpoch = rendererEpoch;
    this.layoutRevision = layoutRevision;
    this.lastSeq = -1;
  }

  setLayoutRevision(layoutRevision: number): void {
    this.layoutRevision = layoutRevision;
  }

  accept(update: BrowserViewportUpdate): boolean {
    if (update.rendererEpoch !== this.rendererEpoch) return false;
    if (update.layoutRevision < this.layoutRevision) return false;
    if (update.seq <= this.lastSeq) return false;
    this.lastSeq = update.seq;
    return true;
  }
}

export { resolvePanelLayout } from "../shared/browser-layout";

type ExpectedInput = { kind: string; key?: string; x?: number; y?: number; expiresAt: number };

/**
 * Ledger of input Main is about to inject. Anything else reaching the page during an
 * agent lease is user input. Entries are short-lived and consumed once (design 7.4).
 */
export class ExpectedInputLedger {
  private entries: ExpectedInput[] = [];
  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 1500) {}

  expect(kind: string, detail: { key?: string; x?: number; y?: number } = {}): void {
    this.prune();
    this.entries.push({ kind, ...detail, expiresAt: this.now() + this.ttlMs });
  }

  /** True (and consumed) when the event matches a planned input. */
  consume(kind: string, detail: { key?: string; x?: number; y?: number } = {}): boolean {
    this.prune();
    const index = this.entries.findIndex((entry) => {
      if (entry.kind !== kind) return false;
      if (entry.key !== undefined && entry.key !== detail.key) return false;
      if (entry.x !== undefined && Math.abs(entry.x - (detail.x ?? Number.NaN)) > 1.5) return false;
      if (entry.y !== undefined && Math.abs(entry.y - (detail.y ?? Number.NaN)) > 1.5) return false;
      return true;
    });
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    this.prune();
    return this.entries.length;
  }

  private prune(): void {
    const now = this.now();
    this.entries = this.entries.filter((entry) => entry.expiresAt > now);
  }
}
