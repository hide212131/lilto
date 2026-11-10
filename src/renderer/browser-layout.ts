import {
  BROWSER_PANEL_DEFAULT_WIDTH,
  BROWSER_PANEL_MAX_WIDTH,
  BROWSER_PANEL_MIN_WIDTH,
  BROWSER_PANEL_WIDTH_KEY
} from "../shared/browser.js";

/** Preferred (user-chosen) panel width; never rewritten by window shrinking. */
export function loadPreferredPanelWidth(): number {
  try {
    const raw = localStorage.getItem(BROWSER_PANEL_WIDTH_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(parsed)) return clampPreferredWidth(parsed);
  } catch {
    // storage unavailable: fall through to the default
  }
  return BROWSER_PANEL_DEFAULT_WIDTH;
}

export function savePreferredPanelWidth(width: number): void {
  try {
    localStorage.setItem(BROWSER_PANEL_WIDTH_KEY, String(clampPreferredWidth(width)));
  } catch {
    // ignore quota errors
  }
}

export function clampPreferredWidth(width: number): number {
  return Math.min(BROWSER_PANEL_MAX_WIDTH, Math.max(BROWSER_PANEL_MIN_WIDTH, Math.round(width)));
}

type Presentation = { open: boolean; occluded: boolean; resizing: boolean };

/**
 * Measures the page viewport placeholder and reports it to Main. Measurements are
 * coalesced to one per animation frame, deduplicated, and tagged with the renderer
 * epoch / monotonically increasing seq / latest layout revision (design 6).
 */
export class BrowserLayoutSync {
  private seq = 0;
  private frame = 0;
  private epoch = "";
  private layoutRevision = 0;
  private lastSent = "";
  private resizeObserver: ResizeObserver | null = null;
  private observed: Element | null = null;
  private readonly onChange = () => this.schedule();

  constructor(
    private readonly getViewport: () => Element | null,
    private readonly getPresentation: () => Presentation,
    private readonly send: (update: ReturnType<BrowserLayoutSync["buildUpdate"]>) => void
  ) {}

  attach(): void {
    window.addEventListener("resize", this.onChange);
    window.addEventListener("scroll", this.onChange, true);
    window.visualViewport?.addEventListener("resize", this.onChange);
    window.visualViewport?.addEventListener("scroll", this.onChange);
    this.resizeObserver = new ResizeObserver(this.onChange);
    this.resizeObserver.observe(document.documentElement);
  }

  detach(): void {
    window.removeEventListener("resize", this.onChange);
    window.removeEventListener("scroll", this.onChange, true);
    window.visualViewport?.removeEventListener("resize", this.onChange);
    window.visualViewport?.removeEventListener("scroll", this.onChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Main reset the epoch (renderer reload) or asked for a fresh measurement. */
  setSync(epoch: string, layoutRevision: number): void {
    if (epoch !== this.epoch || layoutRevision !== this.layoutRevision) this.lastSent = "";
    this.epoch = epoch;
    this.layoutRevision = layoutRevision;
    this.schedule();
  }

  schedule(): void {
    this.observeViewport();
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.flush();
    });
  }

  private observeViewport(): void {
    const element = this.getViewport();
    if (element === this.observed) return;
    if (this.observed) this.resizeObserver?.unobserve(this.observed);
    if (element) this.resizeObserver?.observe(element);
    this.observed = element;
  }

  buildUpdate() {
    const presentation = this.getPresentation();
    const element = this.getViewport();
    const rect = element?.getBoundingClientRect();
    const hostWidth = window.innerWidth;
    const hostHeight = window.innerHeight;
    // Intersect with the host viewport; an absent/collapsed element reports an empty rect.
    const x = Math.max(0, rect?.left ?? 0);
    const y = Math.max(0, rect?.top ?? 0);
    const right = Math.min(hostWidth, rect?.right ?? 0);
    const bottom = Math.min(hostHeight, rect?.bottom ?? 0);
    return {
      rendererEpoch: this.epoch,
      seq: 0,
      layoutRevision: this.layoutRevision,
      viewport: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) },
      hostViewport: { width: hostWidth, height: hostHeight },
      panelOpen: presentation.open,
      occluded: presentation.occluded,
      resizing: presentation.resizing
    };
  }

  flush(): void {
    if (!this.epoch) return;
    const update = this.buildUpdate();
    const key = JSON.stringify({ ...update, seq: 0 });
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.seq += 1;
    this.send({ ...update, seq: this.seq });
  }
}
