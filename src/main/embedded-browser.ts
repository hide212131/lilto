import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  BROWSER_IPC,
  BROWSER_LIMITS,
  BrowserError,
  parseBrowsableUrl,
  type BrowserPanelState,
  type BrowserEvaluateResult,
  type BrowserPresentation,
  type BrowserResult,
  type BrowserSnapshot,
  type BrowserToolState,
  type BrowserViewportUpdate
} from "../shared/browser";
import { buildEvaluateProgram, buildTokenProgram, checkScriptSyntax, envelopeToValue, parseEnvelope } from "./browser-evaluate";
import { FrameTracker, isHttpOrigin, type FrameLike } from "./browser-frames";
import { computeViewBounds, ExpectedInputLedger, ViewportGate, type IntRect } from "./browser-bounds";
import { BrowserOwnership, SerialQueue, type Epochs } from "./browser-ownership";
import { BROWSER_PAGE_WORLD_ID, buildRuntimeCall, type BrowserRuntimeMethod } from "./browser-page-runtime";

/** Minimal surface of Electron objects the controller touches (so tests can fake them). */
export type WebContentsLike = EventEmitter & {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  isDestroyed(): boolean;
  close(options?: { waitForBeforeUnload?: boolean }): void;
  readonly mainFrame: FrameLike;
  reload(): void;
  focus(): void;
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void };
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>;
  sendInputEvent(event: Record<string, unknown>): void;
  insertText(text: string): Promise<void>;
  capturePage(rect?: undefined, options?: { stayHidden?: boolean; stayAwake?: boolean }): Promise<ImageLike>;
  setBackgroundThrottling(allowed: boolean): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  /** Real Electron API; used only on win32 to confirm a frame was actually presented before trusting a capture. */
  beginFrameSubscription?(onlyDirty: boolean, callback: (image: ImageLike, dirtyRect: DirtyRectLike) => void): void;
  endFrameSubscription?(): void;
  /** Real Electron API; used only on win32 to nudge the compositor into presenting a fresh frame after subscribing. */
  invalidate?(): void;
};

/** Electron's Rectangle shape, as handed to beginFrameSubscription's callback. */
export type DirtyRectLike = { x: number; y: number; width: number; height: number };

export type ImageLike = {
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number }): ImageLike;
  toPNG(): Buffer;
};

export type ViewLike = {
  webContents: WebContentsLike;
  setBounds(bounds: IntRect): void;
  setVisible(visible: boolean): void;
};

export type BrowserWindowState = {
  /** A live window exists. */
  present: boolean;
  /** Electron's isVisible(): false while hidden, and false while minimized on macOS. */
  visible: boolean;
  minimized: boolean;
  /** Informational only (diagnostics); never an operation condition. */
  focused: boolean;
};

export interface BrowserHost {
  createView(): ViewLike;
  attachView(view: ViewLike): void;
  detachView(view: ViewLike): void;
  getContentSize(): { width: number; height: number };
  /**
   * A content-size estimate derived from the window's normal (restored) bounds, for use only when
   * `getContentSize()` has collapsed (observed on Windows while minimized). Null when no real,
   * non-minimized measurement has ever been taken to derive the window chrome offset from.
   */
  getNormalContentSize(): { width: number; height: number } | null;
  getZoomFactor(): number;
  /** One consistent read of the host window: operation permission never depends on OS focus. */
  getWindowState(): BrowserWindowState;
  /** Background throttling of the host renderer (the Lit UI that reports the panel layout). */
  setHostBackgroundThrottling(allowed: boolean): void;
  sendToRenderer(channel: string, payload: unknown): void;
  openExternal(url: string): void;
  clearSessionData(): Promise<void>;
  focusHost(): void;
}

export type BrowserRunHandle = { runId: string; conversationId: string; signal: AbortSignal };
type SystemBlock = "locked" | "suspended" | null;
type Ctx = { check: () => void; signal: AbortSignal; deadlineSignal: AbortSignal; effect: "none" | "possible" | "applied"; deadline: number };
export type BrowserControllerSettings = { enabled: boolean; autoOpenOnToolUse: boolean; evaluateEnabled?: boolean };
type Waiter = { resolve: () => void; reject: (error: unknown) => void };

const POLL_MS = 100;
const AUTO_OPEN_WAIT_MS = 3000;
const SCREENSHOT_CAPTURE_MS = 3000;

/**
 * winfix7: true only when a dirtyRect is present and interpretable (has numeric width/height) *and* reports
 * no changed area. Anything uninterpretable (missing, not an object, non-numeric fields) is deliberately
 * treated as "not empty" so a frame is never rejected just because the caller didn't model dirtyRect.
 */
function isDirtyRectEmpty(dirtyRect: DirtyRectLike | null | undefined): boolean {
  if (!dirtyRect || typeof dirtyRect.width !== "number" || typeof dirtyRect.height !== "number") return false;
  return dirtyRect.width <= 0 || dirtyRect.height <= 0;
}

/** winfix7 instrumentation: opt-in via LILTO_SCREENSHOT_DEBUG=1, silent otherwise, never affects behavior. */
function logScreenshotDebug(image: ImageLike, dirtyRect: DirtyRectLike | null | undefined): void {
  if (process.env.LILTO_SCREENSHOT_DEBUG !== "1") return;
  try {
    const size = image.getSize();
    console.error(`[lilto screenshot debug] image=${size.width}x${size.height} dirtyRect=${JSON.stringify(dirtyRect ?? null)}`);
  } catch {
    /* diagnostics must never throw */
  }
}
/** The window is closed to the tray or hidden by the user: the one visibility state that still refuses operations. */
const WINDOW_HIDDEN_MESSAGE = "The Lilto window is explicitly hidden or unavailable";
const KEY_CODES: Record<string, { keyCode: string; char?: string }> = {
  Enter: { keyCode: "Enter", char: "\r" }, Tab: { keyCode: "Tab" }, Escape: { keyCode: "Escape" }, Backspace: { keyCode: "Backspace" },
  Delete: { keyCode: "Delete" }, ArrowUp: { keyCode: "Up" }, ArrowDown: { keyCode: "Down" }, ArrowLeft: { keyCode: "Left" },
  ArrowRight: { keyCode: "Right" }, Home: { keyCode: "Home" }, End: { keyCode: "End" }, PageUp: { keyCode: "PageUp" },
  PageDown: { keyCode: "PageDown" }, Space: { keyCode: "Space", char: " " }
};

export class EmbeddedBrowserController {
  readonly ownership = new BrowserOwnership();
  private readonly queue = new SerialQueue();
  private readonly ledger = new ExpectedInputLedger();
  private readonly gate = new ViewportGate("", 0);
  private readonly waiters = new Set<Waiter>();
  private readonly listeners = new Set<(state: BrowserPanelState) => void>();
  private view: ViewLike | null = null;
  private viewConversationId: string | null = null;
  private revision = 0;
  private layoutRevision = 0;
  private needsRelayout = true;
  private rendererEpoch = "";
  private epochCounter = 0;
  private enabled: boolean;
  private autoOpen: boolean;
  private evaluateEnabled: boolean;
  private frames = new FrameTracker();
  /** Per view: a script was delivered here, so the page may still hold timers/listeners it registered. */
  private viewHadEvaluate = false;
  /** An abandoned view whose destruction is not yet confirmed: no new view may be created meanwhile. */
  private awaitingDestroy: WebContentsLike | null = null;
  private evaluateKey = `__lilto_${randomBytes(9).toString("hex")}`;
  private presentation: BrowserPresentation = { open: false, occluded: false, resizing: false };
  private panelRequested = false;
  private lastBounds: IntRect | null = null;
  /** Last real measurement, kept across a renderer reload (unlike lastBounds) for the minimized fallback (W1). */
  private savedBounds: IntRect | null = null;
  private visibleNow = false;
  /** The view is prepared and shown natively (also while the host window is minimized). */
  private surfaceReady = false;
  /** Explicit hide (close-to-tray); a minimize never sets this. */
  private windowHidden = false;
  private locked = false;
  private suspended = false;
  /** Host window content size / zoom at the last accepted measurement (to detect a changed layout on restore). */
  private measured: { width: number; height: number; zoom: number } | null = null;
  private throttlingOff = false;
  private error: string | null = null;
  private snapshotCounter = 0;
  private latestSnapshot: { id: string; ownershipEpoch: number; documentEpoch: number; at: number } | null = null;
  private lastHttpStatus: number | null = null;
  private disposed = false;
  private policyRevision = 1;

  constructor(private readonly host: BrowserHost, settings: BrowserControllerSettings, private readonly now: () => number = Date.now) {
    this.enabled = settings.enabled;
    this.autoOpen = settings.autoOpenOnToolUse;
    this.evaluateEnabled = settings.evaluateEnabled === true;
    this.frames = new FrameTracker(now);
    this.ownership.setIssuing(settings.enabled);
    this.ownership.onChange = () => {
      this.latestSnapshot = null;
      this.syncThrottling();
      this.publish();
    };
  }

  /* ---------------------------------------------------------------- state */

  onState(listener: (state: BrowserPanelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): BrowserPanelState {
    const wc = this.liveContents();
    return {
      revision: this.revision,
      enabled: this.enabled,
      autoOpenOnToolUse: this.autoOpen,
      panelRequested: this.panelRequested,
      panelVisible: this.visibleNow,
      operationReady: this.operationReady(),
      windowMinimized: this.host.getWindowState().minimized,
      url: wc?.getURL() ?? "",
      title: wc?.getTitle() ?? "",
      loading: wc?.isLoading() ?? false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false,
      owner: this.ownership.ownerView(),
      lastOwnerConversationId: this.ownership.getLastOwnerConversationId(),
      error: this.error,
      layoutRevision: this.layoutRevision,
      rendererEpoch: this.rendererEpoch
    };
  }

  private toolState(): BrowserToolState {
    const wc = this.liveContents();
    return {
      url: wc?.getURL() ?? "",
      title: wc?.getTitle() ?? "",
      documentEpoch: this.ownership.epochs.documentEpoch,
      panelVisible: this.visibleNow,
      operationReady: this.operationReady(),
      windowMinimized: this.host.getWindowState().minimized,
      loading: wc?.isLoading() ?? false
    };
  }

  private publish(): void {
    if (this.disposed) return;
    this.revision += 1;
    const state = this.getState();
    this.host.sendToRenderer(BROWSER_IPC.stateChanged, state);
    for (const listener of this.listeners) listener(state);
    if (this.operationReady() || !this.panelRequested || this.environmentError()) this.flushWaiters();
  }

  private flushWaiters(): void {
    for (const waiter of [...this.waiters]) waiter.resolve();
  }

  private liveContents(): WebContentsLike | null {
    const wc = this.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  /* ------------------------------------------------------- renderer side */

  /** A host renderer (re)loaded: new epoch, hide the view and ask for a fresh layout. */
  beginRendererEpoch(): string {
    this.epochCounter += 1;
    this.rendererEpoch = `r${this.epochCounter}-${this.now().toString(36)}`;
    this.presentation = { open: false, occluded: false, resizing: false };
    this.panelRequested = false;
    this.lastBounds = null;
    this.requestRelayout();
    return this.rendererEpoch;
  }

  /** Hide the view and demand a measurement newer than the current layoutRevision. */
  requestRelayout(): void {
    this.layoutRevision += 1;
    this.needsRelayout = true;
    this.gate.reset(this.rendererEpoch, this.layoutRevision);
    this.ownership.bumpInteraction();
    this.applyView();
    this.publish();
  }

  setPresentation(next: BrowserPresentation): void {
    this.adoptPresentation(next);
    this.applyView();
    this.publish();
  }

  /**
   * Single place where a renderer-reported presentation is adopted, whether it arrives as an
   * explicit presentation message or inside a viewport measurement (they can race).
   */
  private adoptPresentation(next: BrowserPresentation, options: { measured?: boolean } = {}): void {
    const prev = this.presentation;
    this.presentation = { open: next.open === true, occluded: next.occluded === true, resizing: next.resizing === true };
    const blockedChanged = prev.occluded !== this.presentation.occluded || prev.resizing !== this.presentation.resizing;
    if (blockedChanged) {
      // Cancel in-flight operations; they resume only after a fresh measurement.
      this.ownership.bumpInteraction();
      this.view?.setVisible(false);
      this.visibleNow = false;
      this.surfaceReady = false;
      // A viewport message already carries a fresh measurement; only a bare presentation change needs one.
      if (!this.presentation.occluded && !this.presentation.resizing && !options.measured) {
        this.layoutRevision += 1;
        this.needsRelayout = true;
        this.gate.setLayoutRevision(this.layoutRevision);
      }
    }
    if (prev.open && !this.presentation.open) {
      // The user closed the panel: end the lease for good and never auto-reopen on our own.
      this.panelRequested = false;
      this.ownership.expireLease({ interrupted: true });
    } else if (this.presentation.open) {
      this.panelRequested = true;
    }
  }

  updateViewport(update: BrowserViewportUpdate): boolean {
    if (!this.gate.accept(update)) return false;
    const content = this.host.getContentSize();
    // A minimized window may report a collapsed viewport, and on Windows the host's own content size
    // can also collapse to zero while minimized: either way, adopt the panel state but keep the last
    // known-good surface instead of destroying it with an unusable measurement.
    const collapsed =
      update.viewport.width <= 0 || update.viewport.height <= 0 || update.hostViewport.width <= 0 || update.hostViewport.height <= 0 ||
      content.width <= 0 || content.height <= 0;
    const knownGood = this.lastBounds ?? this.savedBounds;
    if (collapsed && update.panelOpen && knownGood !== null && this.host.getWindowState().minimized) {
      this.adoptPresentation({ open: update.panelOpen, occluded: update.occluded, resizing: update.resizing }, { measured: true });
      this.lastBounds = knownGood;
      this.applyView();
      this.publish();
      return true;
    }
    this.adoptPresentation({ open: update.panelOpen, occluded: update.occluded, resizing: update.resizing }, { measured: true });
    // Only a measurement taken against the current layoutRevision satisfies a pending relayout.
    if (update.layoutRevision >= this.layoutRevision) this.needsRelayout = false;
    const zoom = this.host.getZoomFactor();
    const clamped = {
      x: update.viewport.x,
      y: update.viewport.y,
      width: Math.min(update.viewport.width, update.hostViewport.width),
      height: Math.min(update.viewport.height, update.hostViewport.height)
    };
    this.lastBounds = computeViewBounds(clamped, zoom, content);
    if (this.lastBounds) this.savedBounds = this.lastBounds;
    this.measured = { width: content.width, height: content.height, zoom };
    this.applyView();
    this.publish();
    return true;
  }

  private applyView(): void {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) {
      this.visibleNow = false;
      this.surfaceReady = false;
      return;
    }
    const win = this.host.getWindowState();
    // The view stays displayed natively while the window is minimized: only the user-visible panelVisible differs.
    const ready = this.environmentError() === null && this.panelRequested && !this.needsRelayout && this.lastBounds !== null;
    if (ready && this.lastBounds) {
      view.setBounds(this.lastBounds);
      view.setVisible(true);
    } else {
      view.setVisible(false);
    }
    this.surfaceReady = ready;
    this.visibleNow = ready && win.visible && !win.minimized;
  }

  /** Tools may touch the page: surface prepared and the environment gate open. Independent of the minimized state. */
  private operationReady(): boolean {
    return this.surfaceReady && this.environmentError() === null;
  }

  /**
   * Disable background throttling of the page and of the host renderer while an agent holds the browser,
   * so timers, rAF and the panel layout report keep running when the window is minimized or covered.
   * Electron has no getter; the restored value is the default (true). powerSaveBlocker is never used.
   */
  private syncThrottling(): void {
    const want = this.enabled && !this.disposed && this.ownership.getOwner().kind === "agent";
    const wc = this.liveContents();
    if (want) {
      wc?.setBackgroundThrottling(false);
      if (!this.throttlingOff) this.host.setHostBackgroundThrottling(false);
      this.throttlingOff = true;
    } else if (this.throttlingOff) {
      this.throttlingOff = false;
      this.host.setHostBackgroundThrottling(true);
      wc?.setBackgroundThrottling(true);
    }
  }

  /* ------------------------------------------------------- window events */

  /**
   * Measures and caches the window-chrome offset (host.getContentSize()'s side effect) as early as
   * possible, while the window is still guaranteed not minimized — a window can be minimized before
   * any resize/relayout event ever fires, and the offset is only measurable while not minimized. Safe
   * to call at any time; it has no effect on layout state (unlike onWindowGeometryChanged).
   */
  primeChromeOffset(): void {
    this.host.getContentSize();
  }

  onWindowGeometryChanged(): void {
    // Shrinking caused by minimizing is not a layout change; restore compares the real geometry.
    if (this.host.getWindowState().minimized) return;
    this.requestRelayout();
  }

  /** Explicit hide (close button => tray): operations stop and the lease ends. A minimize does not come here. */
  onWindowHidden(): void {
    this.windowHidden = true;
    this.ownership.expireLease({ interrupted: false });
    this.applyView();
    this.publish();
  }

  /** The window was minimized: nothing about the lease, the view or the layout changes. */
  onWindowMinimized(): void {
    this.applyView();
    this.publish();
  }

  /** Restored from minimized: keep the lease; measure again only if the real geometry differs. */
  onWindowRestored(): void {
    const content = this.host.getContentSize();
    const zoom = this.host.getZoomFactor();
    const same = this.measured && this.measured.width === content.width && this.measured.height === content.height && this.measured.zoom === zoom;
    if (same) {
      this.applyView();
      this.publish();
    } else {
      this.requestRelayout();
    }
  }

  /** Shown after an explicit hide (or first show): the old lease is never revived. */
  onWindowShown(): void {
    this.windowHidden = false;
    this.requestRelayout();
  }

  onSystemLocked(): void {
    this.locked = true;
    this.systemBlocked();
  }

  onSystemUnlocked(): void {
    this.locked = false;
    this.applyView();
    this.publish();
  }

  onSystemSuspend(): void {
    this.suspended = true;
    this.systemBlocked();
  }

  onSystemResume(): void {
    this.suspended = false;
    this.applyView();
    this.publish();
  }

  /** Screen lock / suspend: stop delivery and end the lease; it is never resumed automatically. */
  private systemBlocked(): void {
    this.ownership.expireLease({ interrupted: false });
    this.applyView();
    this.publish();
  }

  /* --------------------------------------------------------- user actions */

  async navigateByUser(rawUrl: string): Promise<void> {
    if (!this.enabled) {
      const url = parseBrowsableUrl(rawUrl);
      if (url) this.host.openExternal(url.toString());
      return;
    }
    const url = parseBrowsableUrl(rawUrl);
    if (!url) {
      this.error = "http(s) の URL を入力してください";
      this.publish();
      return;
    }
    if (this.isAwaitingDestroy()) {
      this.error = "前のページを閉じています。少し待ってからもう一度お試しください";
      this.publish();
      return;
    }
    this.error = null;
    this.userTookOver();
    this.panelRequested = true;
    this.ensureView(null);
    this.applyView();
    this.publish();
    await this.loadInView(url.toString());
  }

  /** Link clicked in the chat (or `_blank`): same path as typing an address. */
  openLinkFromHost(rawUrl: string): void {
    if (!parseBrowsableUrl(rawUrl)) return;
    void this.navigateByUser(rawUrl).catch(() => {});
  }

  async goBack(): Promise<void> {
    this.userTookOver();
    const wc = this.liveContents();
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    this.publish();
  }

  async goForward(): Promise<void> {
    this.userTookOver();
    const wc = this.liveContents();
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    this.publish();
  }

  async reloadByUser(): Promise<void> {
    this.userTookOver();
    this.liveContents()?.reload();
    this.publish();
  }

  openCurrentExternally(): void {
    const url = parseBrowsableUrl(this.liveContents()?.getURL());
    if (url) this.host.openExternal(url.toString());
  }

  takeControl(): void {
    this.ownership.takeControl();
  }

  allowAgentControl(): void {
    this.ownership.allowAgentControl();
  }

  private userTookOver(): void {
    this.ownership.expireLease({ interrupted: true });
    this.latestSnapshot = null;
  }

  /* -------------------------------------------------------------- settings */

  async applySettings(next: BrowserControllerSettings): Promise<void> {
    const wasEnabled = this.enabled;
    const wasEvaluate = this.evaluateEnabled;
    const nextEvaluate = next.evaluateEnabled ?? wasEvaluate;
    this.autoOpen = next.autoOpenOnToolUse;
    this.evaluateEnabled = nextEvaluate;
    if (wasEnabled !== next.enabled || wasEvaluate !== nextEvaluate) this.policyRevision += 1;
    if (wasEvaluate && !nextEvaluate && wasEnabled && next.enabled && this.viewHadEvaluate) {
      // Scripts ran in this page: they may have left timers/listeners. Closing is the only reliable cleanup.
      this.ownership.revokeAllRuns();
      this.abandonView("AI のページ内 JavaScript を無効にしたため、実行済みのページを閉じました");
    }
    if (wasEnabled && !next.enabled) {
      this.ownership.setIssuing(false);
      this.ownership.revokeAllRuns();
      this.enabled = false;
      this.closeView();
      this.panelRequested = false;
      this.error = null;
      await this.host.clearSessionData();
    } else if (!wasEnabled && next.enabled) {
      this.enabled = true;
    }
    // prepare() stopped issuing for any permission change; whatever the outcome, issuing follows `enabled`.
    this.ownership.setIssuing(this.enabled);
    this.publish();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isEvaluateEnabled(): boolean {
    return this.enabled && this.evaluateEnabled;
  }

  getPolicyRevision(): number {
    return this.policyRevision;
  }

  issueRun(input: { conversationId: string; requestId: string; policyRevision: number }) {
    return this.ownership.issueRun(input);
  }

  dispose(): void {
    this.ownership.revokeAllRuns();
    this.closeView();
    this.disposed = true;
    this.syncThrottling();
    this.flushWaiters();
  }

  /* ------------------------------------------------------------------ view */

  private ensureView(forConversationId: string | null): ViewLike {
    if (this.view && !this.view.webContents.isDestroyed() && (forConversationId === null || this.viewConversationId === forConversationId)) {
      return this.view;
    }
    if (this.isAwaitingDestroy()) throw new BrowserError("BROWSER_UNAVAILABLE", "The previous page is still being closed; try again shortly", { retryable: true });
    if (this.view) this.closeView();
    const view = this.host.createView();
    this.view = view;
    this.viewConversationId = forConversationId;
    this.viewHadEvaluate = false;
    this.frames = new FrameTracker(this.now);
    this.ownership.bumpView();
    this.latestSnapshot = null;
    this.wireView(view);
    this.host.attachView(view);
    view.setVisible(false);
    if (this.throttlingOff) view.webContents.setBackgroundThrottling(false);
    // An already-open, already-measured panel must show the replacement view immediately.
    this.applyView();
    this.publish();
    return view;
  }

  private closeView(): WebContentsLike | null {
    const view = this.view;
    if (!view) return null;
    this.view = null;
    this.viewConversationId = null;
    this.visibleNow = false;
    this.surfaceReady = false;
    this.ownership.bumpView();
    this.latestSnapshot = null;
    this.frames.clear();
    this.viewHadEvaluate = false;
    try {
      this.host.detachView(view);
    } catch {
      /* window may already be gone */
    }
    // Never wait for a beforeunload handler: a hung or hostile page must not keep the view alive.
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    return view.webContents;
  }

  private isAwaitingDestroy(): boolean {
    const pending = this.awaitingDestroy;
    if (pending && pending.isDestroyed()) this.awaitingDestroy = null;
    return this.awaitingDestroy !== null;
  }

  /**
   * A delivered script did not finish (timeout/cancel/settings) or may have left background work:
   * invalidate the lease and every id, and close the view. Creation of a new view is refused until
   * the old one is confirmed destroyed. No automatic reload or re-run.
   */
  private abandonView(message: string): void {
    this.ownership.expireLease({ interrupted: false });
    const wc = this.closeView();
    this.latestSnapshot = null;
    this.error = message;
    if (wc && !wc.isDestroyed()) {
      this.awaitingDestroy = wc;
      const clear = () => {
        if (this.awaitingDestroy === wc) this.awaitingDestroy = null;
      };
      wc.once("destroyed", clear);
      const poll = setInterval(() => {
        if (wc.isDestroyed()) {
          clearInterval(poll);
          clear();
        }
      }, 100);
      poll.unref?.();
    }
    this.publish();
  }

  private wireView(view: ViewLike): void {
    const wc = view.webContents;
    const isMain = (details: unknown) => !details || (details as { isMainFrame?: boolean }).isMainFrame !== false;
    const block = (event: { preventDefault(): void }, target: string) => {
      if (!parseBrowsableUrl(target)) event.preventDefault();
    };
    wc.on("will-navigate", (...args: unknown[]) => block(args[0] as { preventDefault(): void }, String(args[1] ?? (args[0] as { url?: string }).url ?? "")));
    wc.on("will-redirect", (...args: unknown[]) => block(args[0] as { preventDefault(): void }, String(args[1] ?? (args[0] as { url?: string }).url ?? "")));
    wc.on("will-frame-navigate", (...args: unknown[]) => {
      const details = args[0] as { preventDefault(): void; url?: string; isMainFrame?: boolean };
      if (details.isMainFrame !== false) block(details, String(details.url ?? ""));
    });
    wc.setWindowOpenHandler(({ url }) => {
      // Popups never get a window; http(s) targets load in this same surface.
      if (parseBrowsableUrl(url)) void this.loadInView(url).catch(() => {});
      return { action: "deny" };
    });
    const frames = this.frames;
    const root = () => (wc.isDestroyed() ? null : wc.mainFrame);
    // Frame generations (design 3.3): navigation start, commit and in-page navigation all invalidate frame ids.
    wc.on("did-start-navigation", (...args: unknown[]) => {
      const details = args[0] as { frame?: { frameTreeNodeId?: number } | null; isSameDocument?: boolean } | undefined;
      frames.onNavigation(root(), details?.frame);
    });
    wc.on("did-frame-navigate", (...args: unknown[]) => {
      frames.onNavigation(root(), null, { processId: Number(args[5]), routingId: Number(args[6]) });
    });
    wc.on("did-navigate-in-page", (...args: unknown[]) => {
      frames.onNavigation(root(), null, { processId: Number(args[3]), routingId: Number(args[4]) });
    });
    const documentChanged = () => {
      this.ownership.bumpDocument();
      this.latestSnapshot = null;
      this.publish();
    };
    wc.on("did-start-navigation", (...args: unknown[]) => {
      const details = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean } | undefined;
      if (isMain(details) && !details?.isSameDocument) documentChanged();
    });
    wc.on("did-navigate-in-page", (...args: unknown[]) => {
      if (args[2] !== false) documentChanged();
    });
    wc.on("did-navigate", (...args: unknown[]) => {
      this.lastHttpStatus = typeof args[2] === "number" && args[2] > 0 ? args[2] : null;
      this.error = null;
      this.publish();
    });
    for (const name of ["page-title-updated", "did-start-loading", "did-stop-loading"]) wc.on(name, () => this.publish());
    wc.on("did-fail-load", (...args: unknown[]) => {
      const errorCode = Number(args[1]);
      const isMainFrame = args[4] !== false;
      if (errorCode === -3 || !isMainFrame) return;
      this.error = `読み込みに失敗しました（${String(args[2] ?? errorCode)}）`;
      this.publish();
    });
    wc.on("render-process-gone", () => {
      this.error = "ページが停止しました";
      this.ownership.expireLease({ interrupted: false });
      this.ownership.bumpView();
      this.visibleNow = false;
      this.surfaceReady = false;
      this.publish();
    });
    wc.on("before-input-event", (...args: unknown[]) => {
      const event = args[0] as { preventDefault(): void };
      const input = args[1] as { type?: string; x?: number; y?: number };
      this.handleRawInput(event, `key:${input?.type ?? ""}`, {});
    });
    wc.on("before-mouse-event", (...args: unknown[]) => {
      const event = args[0] as { preventDefault(): void };
      const mouse = args[1] as { type?: string; x?: number; y?: number };
      this.handleRawInput(event, `mouse:${mouse?.type ?? ""}`, { x: mouse?.x, y: mouse?.y });
    });
  }

  /** Input that reaches the page while an agent holds the lease and Main did not plan it. */
  private handleRawInput(event: { preventDefault(): void }, kind: string, detail: { x?: number; y?: number }): void {
    if (this.ownership.getOwner().kind !== "agent") return;
    const interrupting = kind === "key:keyDown" || kind === "key:rawKeyDown" || kind === "key:char" || kind === "mouse:mouseDown";
    if (!interrupting) {
      this.ledger.consume(kind, detail);
      return;
    }
    if (this.ledger.consume(kind, detail)) return;
    event.preventDefault();
    this.ledger.clear();
    this.ownership.takeControl();
    this.error = "手動操作に切り替えました。AI の操作を再開するには「AI に操作を許可」を押してください";
    this.publish();
  }

  /* --------------------------------------------------------- loading core */

  private async loadInView(url: string, options: { waitUntil?: "domcontentloaded" | "load"; timeoutMs?: number; signal?: AbortSignal; check?: () => void } = {}): Promise<{ finalUrl: string; httpStatus: number | null }> {
    const wc = this.liveContents();
    if (!wc) throw new BrowserError("BROWSER_UNAVAILABLE", "The browser view is not available");
    if (!parseBrowsableUrl(url)) throw new BrowserError("NAVIGATION_BLOCKED", "Only http(s) URLs without credentials are allowed");
    const waitUntil = options.waitUntil ?? "load";
    const timeoutMs = options.timeoutMs ?? BROWSER_LIMITS.timeoutDefaultMs;
    this.lastHttpStatus = null;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        wc.removeListener("dom-ready", onDomReady);
        wc.removeListener("did-fail-load", onFail);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (error: unknown | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve({ finalUrl: wc.isDestroyed() ? url : wc.getURL(), httpStatus: this.lastHttpStatus });
      };
      const onDomReady = () => {
        if (waitUntil === "domcontentloaded") finish(null);
      };
      const onFail = (...args: unknown[]) => {
        if (Number(args[1]) === -3 || args[4] === false) return;
        finish(new BrowserError("NAVIGATION_FAILED", `Navigation failed (${String(args[2] ?? args[1])})`, { effect: "possible" }));
      };
      const onAbort = () => finish(new BrowserError("CANCELLED", "The operation was cancelled"));
      const timer = setTimeout(() => finish(new BrowserError("TIMEOUT", "Navigation timed out", { effect: "possible" })), timeoutMs);
      wc.on("dom-ready", onDomReady);
      wc.on("did-fail-load", onFail);
      if (options.signal?.aborted) return onAbort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      wc.loadURL(url).then(
        () => finish(null),
        (error: unknown) => {
          // ERR_ABORTED (-3) happens for redirects/superseded loads; real failures arrive via did-fail-load.
          const message = error instanceof Error ? error.message : String(error);
          if (/ERR_ABORTED|\(-3\)/.test(message)) return;
          finish(new BrowserError("NAVIGATION_FAILED", `Navigation failed: ${message.slice(0, 200)}`, { effect: "possible" }));
        }
      );
    });
  }

  /* ------------------------------------------------------------ tool core */

  /**
   * The environment gate shared by every tool: settings, teardown, an explicitly hidden window, screen lock /
   * suspend, and in-app modal / resize. A minimized, unfocused or covered window is NOT a reason to refuse.
   */
  private environmentError(): BrowserError | null {
    if (!this.enabled) return new BrowserError("BROWSER_DISABLED", "The embedded browser is disabled in settings");
    const win = this.disposed ? null : this.host.getWindowState();
    if (!win || !win.present || this.windowHidden || (!win.visible && !win.minimized)) return new BrowserError("BROWSER_UNAVAILABLE", WINDOW_HIDDEN_MESSAGE);
    if (this.suspended) return new BrowserError("SYSTEM_SUSPENDED", "The computer is suspending or has just resumed; call a tool again later", { retryable: true });
    if (this.locked) return new BrowserError("SYSTEM_LOCKED", "The screen is locked; browser operations are paused until it is unlocked", { retryable: true });
    if (this.presentation.occluded || this.presentation.resizing) return new BrowserError("PANEL_OCCLUDED", "A dialog or resize is covering the browser panel", { retryable: true });
    return null;
  }

  /**
   * On some platforms (observed on Windows) a minimized window's renderer never completes a layout
   * measurement, so the real report that normally satisfies `needsRelayout` never arrives. Only once the
   * wait has actually timed out, and only while minimized, fall back to the last known-good surface size
   * (this epoch's `lastBounds`, else the last `savedBounds` across a reload, else the full host content
   * area) so operations are not permanently blocked. A real measurement on restore still re-validates it.
   */
  private applyMinimizedFallbackLayout(): boolean {
    if (!this.needsRelayout) return false;
    if (!this.host.getWindowState().minimized) return false;
    let fallback = this.lastBounds ?? this.savedBounds;
    if (!fallback) {
      const content = this.host.getContentSize();
      if (content.width > 0 && content.height > 0) {
        fallback = { x: 0, y: 0, width: content.width, height: content.height };
      } else {
        // Windows can report a collapsed content size while minimized even on the very first
        // measurement, with no prior real bounds to fall back to; the window's own measured normal
        // (restored) bounds are still real geometry, not a guess.
        const normal = this.host.getNormalContentSize();
        if (normal && normal.width > 0 && normal.height > 0) fallback = { x: 0, y: 0, width: normal.width, height: normal.height };
      }
    }
    if (!fallback) return false;
    this.lastBounds = fallback;
    this.needsRelayout = false;
    this.applyView();
    this.publish();
    return true;
  }

  /** Prepare the operation surface (auto-open the panel logically, even while minimized) before touching the page. */
  private async ensureOperable(signal: AbortSignal, timeoutMs: number): Promise<void> {
    const blocked = this.environmentError();
    if (blocked) throw blocked;
    if (this.operationReady()) return;
    if (!this.panelRequested) {
      if (!this.autoOpen) throw new BrowserError("PANEL_CLOSED", "The browser panel is closed. Ask the user to open it.");
      this.panelRequested = true;
      this.publish();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve: () => done(null), reject: (error) => done(error) };
      const timer = setTimeout(() => {
        if (this.applyMinimizedFallbackLayout()) done(null);
        else done(new BrowserError("PANEL_NOT_READY", "The browser panel did not report a usable layout in time", { retryable: true }));
      }, Math.min(timeoutMs, AUTO_OPEN_WAIT_MS));
      const onAbort = () => done(new BrowserError("CANCELLED", "The operation was cancelled"));
      const done = (error: unknown | null) => {
        if (!this.waiters.delete(waiter)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else {
          const blockedNow = this.environmentError();
          if (blockedNow) reject(blockedNow);
          else if (!this.panelRequested) reject(new BrowserError("PANEL_CLOSED", "The browser panel was closed"));
          else if (!this.operationReady()) reject(new BrowserError("PANEL_NOT_READY", "The browser panel is not ready", { retryable: true }));
          else resolve();
        }
      };
      this.waiters.add(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      else if (this.operationReady()) done(null);
    });
  }

  private async run<T>(
    run: BrowserRunHandle,
    leaseId: string,
    options: { timeoutMs?: number; snapshotId?: string; sharedDeadline?: boolean; documentEpoch?: number },
    body: (ctx: Ctx) => Promise<T>
  ): Promise<BrowserResult<T>> {
    const timeoutMs = options.timeoutMs ?? BROWSER_LIMITS.timeoutDefaultMs;
    const startedAt = this.now();
    let effect: Ctx["effect"] = "none";
    try {
      if (!this.enabled) throw new BrowserError("BROWSER_DISABLED", "The embedded browser is disabled in settings");
      if (options.sharedDeadline && !this.evaluateEnabled) throw new BrowserError("EVALUATE_DISABLED", "Page JavaScript execution is disabled in settings");
      const blockedNow = this.environmentError();
      if (blockedNow) throw blockedNow;
      this.ownership.assertLease(run.runId, leaseId);
      await this.ensureOperable(run.signal, timeoutMs);
      // One deadline for the whole request (panel wait + queue + run), not a fresh budget per stage.
      const remainingMs = options.sharedDeadline ? Math.max(1, timeoutMs - (this.now() - startedAt)) : timeoutMs;
      if (options.documentEpoch !== undefined && options.documentEpoch !== this.ownership.epochs.documentEpoch) {
        throw new BrowserError("STALE_DOCUMENT", "The page changed since documentEpoch was observed; read the current state first");
      }
      const before: Epochs = this.ownership.snapshotEpochs();
      let expired = false;
      const deadlineAbort = new AbortController();
      const signal = AbortSignal.any([run.signal, this.ownership.leaseSignal(run.runId, leaseId)]);
      const ctx: Ctx = {
        signal,
        deadlineSignal: deadlineAbort.signal,
        get effect() { return effect; },
        set effect(value) { effect = value; },
        deadline: this.now() + remainingMs,
        check: () => {
          // Hide, lock, suspend and modal/resize end delivery here too; the effect so far is kept.
          const env = this.enabled ? this.environmentError() : null;
          if (env) throw new BrowserError(env.code, env.message, { retryable: env.retryable && effect === "none", effect });
          if (signal.aborted || !this.ownership.isRunActive(run.runId)) throw new BrowserError("CANCELLED", "The operation was cancelled", { effect });
          if (expired) throw new BrowserError("TIMEOUT", "The operation timed out", { retryable: false, effect });
          this.ownership.assertLease(run.runId, leaseId);
          if (!this.ownership.unchanged(before, ["viewEpoch", "ownershipEpoch"])) throw new BrowserError("LEASE_EXPIRED", "The browser changed during the operation", { effect });
          if (this.ownership.epochs.interactionEpoch !== before.interactionEpoch) {
            throw new BrowserError(this.presentation.occluded || this.presentation.resizing ? "PANEL_OCCLUDED" : "CANCELLED", "The operation was interrupted", { effect });
          }
          if (!this.enabled) throw new BrowserError("BROWSER_DISABLED", "The embedded browser is disabled in settings", { effect });
          if (!this.liveContents()) throw new BrowserError("PAGE_CRASHED", "The page is not available", { effect });
        }
      };
      if (options.snapshotId !== undefined) this.assertSnapshot(options.snapshotId);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          deadlineAbort.abort();
          reject(new BrowserError("TIMEOUT", "The operation timed out", { effect }));
        }, remainingMs);
      });
      try {
        const result = await Promise.race([this.queue.enqueue(() => body(ctx), ctx.check), timeout]);
        return { ok: true, state: this.toolState(), result };
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      return this.failure(error, effect);
    }
  }

  private failure(error: unknown, effect: Ctx["effect"] = "none"): BrowserResult<never> {
    if (error instanceof BrowserError) {
      const payload = error.toJSON();
      if (payload.effect === "none" && effect !== "none") payload.effect = effect;
      return { ok: false, error: payload };
    }
    return { ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message.slice(0, 300) : "Unexpected error", retryable: false, effect } };
  }

  private assertSnapshot(snapshotId: string): void {
    const latest = this.latestSnapshot;
    if (!latest || latest.id !== snapshotId || latest.ownershipEpoch !== this.ownership.epochs.ownershipEpoch || latest.documentEpoch !== this.ownership.epochs.documentEpoch || this.now() - latest.at > BROWSER_LIMITS.snapshotTtlMs) {
      throw new BrowserError("STALE_REF", "The snapshot is outdated; call browser_snapshot again");
    }
  }

  private async page<T = Record<string, unknown>>(method: BrowserRuntimeMethod, args: unknown): Promise<T & { ok: boolean; code?: string; message?: string }> {
    const wc = this.liveContents();
    if (!wc) throw new BrowserError("PAGE_CRASHED", "The page is not available");
    const result = (await wc.executeJavaScriptInIsolatedWorld(BROWSER_PAGE_WORLD_ID, [{ code: buildRuntimeCall(method, args) }])) as T & { ok: boolean; code?: string; message?: string };
    if (!result || typeof result !== "object") throw new BrowserError("INTERNAL_ERROR", "The page runtime returned no result");
    return result;
  }

  private unwrap<T extends { ok: boolean; code?: string; message?: string }>(result: T, effect: Ctx["effect"] = "none"): T {
    if (!result.ok) {
      const code = (result.code ?? "INTERNAL_ERROR") as BrowserError["code"];
      throw new BrowserError(code, result.message ?? "Page operation failed", { effect });
    }
    return result;
  }

  /* ------------------------------------------------------------ tool API */

  status(): BrowserResult<Record<string, unknown>> {
    const wc = this.liveContents();
    const blocked = this.environmentError();
    return {
      ok: true,
      state: this.toolState(),
      result: {
        enabled: this.enabled,
        // Occlusion/resizing and a minimized window do not make the browser unavailable; the diagnosis is in blockedReason.
        available: blocked === null || blocked.code === "PANEL_OCCLUDED",
        owner: this.ownership.ownerView(),
        panelOpen: this.panelRequested,
        panelVisible: this.visibleNow,
        operationReady: this.operationReady(),
        windowMinimized: this.host.getWindowState().minimized,
        evaluateEnabled: this.isEvaluateEnabled(),
        canGoBack: wc?.navigationHistory.canGoBack() ?? false,
        canGoForward: wc?.navigationHistory.canGoForward() ?? false,
        blockedReason: blocked?.code ?? null
      }
    };
  }

  async acquire(run: BrowserRunHandle, args: { url: string; timeoutMs?: number }): Promise<BrowserResult<{ leaseId: string }>> {
    const timeoutMs = args.timeoutMs ?? BROWSER_LIMITS.timeoutDefaultMs;
    let leaseId: string | null = null;
    try {
      if (!this.enabled) throw new BrowserError("BROWSER_DISABLED", "The embedded browser is disabled in settings");
      const url = parseBrowsableUrl(args.url);
      if (!url) throw new BrowserError("NAVIGATION_BLOCKED", "Only http(s) URLs without credentials are allowed");
      const early = this.environmentError();
      if (early) throw early;
      const acquired = this.ownership.acquire(run.runId);
      leaseId = acquired.leaseId;
      if (acquired.reused) {
        const current = this.liveContents()?.getURL();
        if (current && current !== url.toString()) {
          throw new BrowserError("NAVIGATION_BLOCKED", "This run already holds the browser; use browser_navigate to change the URL");
        }
        return { ok: true, state: this.toolState(), result: { leaseId } };
      }
      this.ensureView(run.conversationId);
      this.error = null;
      const lease = leaseId;
      const result = await this.run(run, lease, { timeoutMs }, async (ctx) => {
        ctx.check();
        await this.loadInView(url.toString(), { waitUntil: "load", timeoutMs, signal: ctx.signal });
        ctx.check();
        return { leaseId: lease };
      });
      if (!result.ok) {
        // The agent never receives the lease on failure; do not leave it orphaned.
        if (this.ownership.getOwner().kind === "agent") this.ownership.expireLease({ interrupted: false });
        return result;
      }
      return result;
    } catch (error) {
      if (leaseId && this.ownership.getOwner().kind === "agent") this.ownership.expireLease({ interrupted: false });
      return this.failure(error);
    }
  }

  async release(run: BrowserRunHandle, args: { leaseId: string }): Promise<BrowserResult<{ released: true }>> {
    try {
      this.ownership.release(run.runId, args.leaseId);
      return { ok: true, state: this.toolState(), result: { released: true } };
    } catch (error) {
      return this.failure(error);
    }
  }

  navigate(run: BrowserRunHandle, args: { leaseId: string; url: string; waitUntil?: "domcontentloaded" | "load"; timeoutMs?: number }) {
    const parsed = parseBrowsableUrl(args.url);
    if (!parsed) return Promise.resolve(this.failure(new BrowserError("NAVIGATION_BLOCKED", "Only http(s) URLs without credentials are allowed")));
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs }, async (ctx) => {
      ctx.check();
      ctx.effect = "possible";
      const out = await this.loadInView(parsed.toString(), { waitUntil: args.waitUntil, timeoutMs: args.timeoutMs, signal: ctx.signal });
      ctx.check();
      return out;
    });
  }

  private history(run: BrowserRunHandle, args: { leaseId: string; timeoutMs?: number }, direction: "back" | "forward") {
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs }, async (ctx) => {
      const wc = this.liveContents();
      if (!wc) throw new BrowserError("PAGE_CRASHED", "The page is not available");
      const can = direction === "back" ? wc.navigationHistory.canGoBack() : wc.navigationHistory.canGoForward();
      if (!can) return { navigated: false };
      ctx.check();
      ctx.effect = "possible";
      const settled = this.waitForStop(wc, args.timeoutMs ?? BROWSER_LIMITS.timeoutDefaultMs, ctx.signal);
      if (direction === "back") wc.navigationHistory.goBack();
      else wc.navigationHistory.goForward();
      await settled;
      ctx.check();
      return { navigated: true };
    });
  }

  back(run: BrowserRunHandle, args: { leaseId: string; timeoutMs?: number }) {
    return this.history(run, args, "back");
  }

  forward(run: BrowserRunHandle, args: { leaseId: string; timeoutMs?: number }) {
    return this.history(run, args, "forward");
  }

  reload(run: BrowserRunHandle, args: { leaseId: string; timeoutMs?: number }) {
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs }, async (ctx) => {
      const wc = this.liveContents();
      if (!wc) throw new BrowserError("PAGE_CRASHED", "The page is not available");
      ctx.check();
      ctx.effect = "possible";
      const settled = this.waitForStop(wc, args.timeoutMs ?? BROWSER_LIMITS.timeoutDefaultMs, ctx.signal);
      wc.reload();
      await settled;
      ctx.check();
      return { reloaded: true as const };
    });
  }

  private waitForStop(wc: WebContentsLike, timeoutMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (error: unknown | null) => {
        clearTimeout(timer);
        wc.removeListener("did-stop-loading", onStop);
        wc.removeListener("did-fail-load", onFail);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onStop = () => done(null);
      const onFail = (...args: unknown[]) => {
        if (Number(args[1]) !== -3 && args[4] !== false) done(new BrowserError("NAVIGATION_FAILED", "Navigation failed", { effect: "possible" }));
      };
      const onAbort = () => done(new BrowserError("CANCELLED", "The operation was cancelled"));
      const timer = setTimeout(() => done(new BrowserError("TIMEOUT", "Navigation timed out", { effect: "possible" })), timeoutMs);
      wc.on("did-stop-loading", onStop);
      wc.on("did-fail-load", onFail);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  snapshot(run: BrowserRunHandle, args: { leaseId: string; maxNodes?: number }): Promise<BrowserResult<BrowserSnapshot>> {
    return this.run(run, args.leaseId, {}, async (ctx) => {
      ctx.check();
      const epochs = this.ownership.epochs;
      this.snapshotCounter += 1;
      const snapshotId = `s${this.snapshotCounter}-${epochs.viewEpoch}-${epochs.ownershipEpoch}-${epochs.documentEpoch}`;
      const raw = await this.page<{ snapshot: BrowserSnapshot }>("snapshot", {
        snapshotId,
        ownershipEpoch: epochs.ownershipEpoch,
        documentEpoch: epochs.documentEpoch,
        maxNodes: args.maxNodes ?? BROWSER_LIMITS.snapshotDefaultNodes
      });
      ctx.check();
      this.unwrap(raw);
      this.latestSnapshot = { id: snapshotId, ownershipEpoch: epochs.ownershipEpoch, documentEpoch: epochs.documentEpoch, at: this.now() };
      const snapshot: BrowserSnapshot = raw.snapshot;
      const wc = this.liveContents();
      if (this.isEvaluateEnabled() && wc && this.ownership.unchanged(epochs, ["viewEpoch", "ownershipEpoch", "documentEpoch"])) {
        const listed = this.frames.list(wc.mainFrame, { viewEpoch: epochs.viewEpoch, ownershipEpoch: epochs.ownershipEpoch, documentEpoch: epochs.documentEpoch });
        snapshot.frames = listed.frames;
        snapshot.framesTruncated = listed.truncated;
      }
      return snapshot;
    });
  }

  /* ---------------------------------------------------------------- input */

  private modifiersOf(list: string[] | undefined): string[] {
    return (list ?? []).map((name) => name.toLowerCase());
  }

  click(run: BrowserRunHandle, args: { leaseId: string; snapshotId: string; ref: string; button?: "left" | "right"; clickCount?: 1 | 2; timeoutMs?: number }) {
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs, snapshotId: args.snapshotId }, async (ctx) => {
      ctx.check();
      const target = this.unwrap(await this.page<{ x: number; y: number }>("prepareClick", { snapshotId: args.snapshotId, ref: args.ref }));
      ctx.check();
      const wc = this.liveContents()!;
      const button = args.button ?? "left";
      const count = args.clickCount ?? 1;
      const at = { x: Math.round(target.x), y: Math.round(target.y) };
      ctx.effect = "possible";
      this.ledger.expect("mouse:mouseMove", at);
      wc.sendInputEvent({ type: "mouseMove", ...at });
      for (let i = 1; i <= count; i += 1) {
        this.ledger.expect("mouse:mouseDown", at);
        this.ledger.expect("mouse:mouseUp", at);
        wc.sendInputEvent({ type: "mouseDown", ...at, button, clickCount: i });
        wc.sendInputEvent({ type: "mouseUp", ...at, button, clickCount: i });
      }
      return { dispatched: true as const };
    });
  }

  fill(run: BrowserRunHandle, args: { leaseId: string; snapshotId: string; ref: string; text: string; timeoutMs?: number }) {
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs, snapshotId: args.snapshotId }, async (ctx) => {
      ctx.check();
      const prepared = this.unwrap(await this.page<{ empty: boolean }>("prepareFill", { snapshotId: args.snapshotId, ref: args.ref }));
      ctx.check();
      const wc = this.liveContents()!;
      ctx.effect = "possible";
      if (args.text.length > 0) {
        await wc.insertText(args.text);
      } else if (!prepared.empty) {
        this.ledger.expect("key:keyDown");
        this.ledger.expect("key:keyUp");
        wc.sendInputEvent({ type: "keyDown", keyCode: "Delete" });
        wc.sendInputEvent({ type: "keyUp", keyCode: "Delete" });
      }
      ctx.check();
      const verified = this.unwrap(await this.page<{ matches: boolean; focused: boolean }>("verifyFill", { snapshotId: args.snapshotId, ref: args.ref, text: args.text }), "possible");
      if (!verified.matches) throw new BrowserError("INTERNAL_ERROR", "The field value did not match after typing; take a snapshot and check", { effect: "applied" });
      return { filled: true as const };
    });
  }

  select(run: BrowserRunHandle, args: { leaseId: string; snapshotId: string; ref: string; values: string[]; timeoutMs?: number }) {
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs, snapshotId: args.snapshotId }, async (ctx) => {
      ctx.check();
      ctx.effect = "possible";
      const out = this.unwrap(await this.page<{ selectedValues: string[] }>("selectOptions", { snapshotId: args.snapshotId, ref: args.ref, values: args.values }), "possible");
      return { selectedValues: out.selectedValues };
    });
  }

  press(run: BrowserRunHandle, args: { leaseId: string; snapshotId: string; ref: string; key: string; modifiers?: string[]; timeoutMs?: number }) {
    const key = KEY_CODES[args.key];
    if (!key) return Promise.resolve(this.failure(new BrowserError("INTERNAL_ERROR", "Unsupported key")));
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs, snapshotId: args.snapshotId }, async (ctx) => {
      ctx.check();
      this.unwrap(await this.page("prepareFocus", { snapshotId: args.snapshotId, ref: args.ref }));
      ctx.check();
      const wc = this.liveContents()!;
      const modifiers = this.modifiersOf(args.modifiers);
      ctx.effect = "possible";
      this.ledger.expect("key:keyDown");
      this.ledger.expect("key:keyUp");
      wc.sendInputEvent({ type: "keyDown", keyCode: key.keyCode, modifiers });
      if (key.char && modifiers.length === 0) {
        this.ledger.expect("key:char");
        wc.sendInputEvent({ type: "char", keyCode: key.char, modifiers });
      }
      wc.sendInputEvent({ type: "keyUp", keyCode: key.keyCode, modifiers });
      return { dispatched: true as const };
    });
  }

  scroll(run: BrowserRunHandle, args: { leaseId: string; snapshotId?: string; ref?: string; deltaX?: number; deltaY: number }) {
    return this.run(run, args.leaseId, { snapshotId: args.snapshotId }, async (ctx) => {
      ctx.check();
      ctx.effect = "applied";
      const out = this.unwrap(await this.page<{ scrollX: number; scrollY: number }>("scroll", { snapshotId: args.snapshotId, ref: args.ref, deltaX: args.deltaX ?? 0, deltaY: args.deltaY }), "applied");
      return { scrollX: out.scrollX, scrollY: out.scrollY };
    });
  }

  getText(run: BrowserRunHandle, args: { leaseId: string; snapshotId?: string; ref?: string; maxChars?: number }) {
    return this.run(run, args.leaseId, { snapshotId: args.snapshotId }, async (ctx) => {
      ctx.check();
      const out = this.unwrap(await this.page<{ text: string; truncated: boolean }>("getText", { snapshotId: args.snapshotId, ref: args.ref, maxChars: args.maxChars ?? BROWSER_LIMITS.textDefaultChars }));
      return { text: out.text, truncated: out.truncated };
    });
  }

  screenshot(run: BrowserRunHandle, args: { leaseId: string }) {
    return this.run(run, args.leaseId, {}, async (ctx) => {
      ctx.check();
      const wc = this.liveContents();
      if (!wc) throw new BrowserError("PAGE_CRASHED", "The page is not available");
      // Current frame only: wait for the page to paint, then capture while hidden-safe (design 7). No cached image,
      // no restore of the window. A page whose frames cannot be produced fails explicitly.
      let image: ImageLike;
      if (process.platform === "win32" && wc.beginFrameSubscription) {
        // win32-only: a minimized window's compositor can silently stop presenting new frames, which makes
        // capturePage() succeed with a stale image instead of erroring — and on CI's software compositor,
        // capturePage() can even return a stale surface right after beginFrameSubscription confirms a fresh
        // one was presented, because the two draw from different pipelines. So on win32 we capture the exact
        // bitmap handed to the subscription callback instead of calling capturePage() at all; that bitmap is
        // the presented frame, not a separate (possibly-stale) read of it. Extra conditions on top of "take
        // the first presented frame" were tried and dropped after real Windows runs: requiring a *second*
        // post-settle frame, and requiring the frame to arrive *after* settleFrames resolves, both discarded
        // the only frame a static page ever presents, turning every such screenshot into a false
        // SCREENSHOT_UNAVAILABLE. settleFrames still runs first so the frame it produces is in flight before
        // the subscription starts.
        this.unwrap(await this.page("settleFrames", {}));
        ctx.check();
        image = await this.awaitPresentedFrame(wc, SCREENSHOT_CAPTURE_MS);
      } else {
        this.unwrap(await this.page("settleFrames", {}));
        ctx.check();
        image = await this.capturePageWithTimeout(wc, SCREENSHOT_CAPTURE_MS);
      }
      ctx.check();
      if (!image.getSize().width || !image.getSize().height) throw new BrowserError("SCREENSHOT_UNAVAILABLE", "The page surface could not be captured");
      const { width, height } = image.getSize();
      const edge = Math.max(width, height);
      let outWidth = width;
      let outHeight = height;
      if (edge > BROWSER_LIMITS.screenshotMaxEdge) {
        const scale = BROWSER_LIMITS.screenshotMaxEdge / edge;
        outWidth = Math.max(1, Math.round(width * scale));
        outHeight = Math.max(1, Math.round(height * scale));
        image = image.resize({ width: outWidth, height: outHeight });
      }
      const png = image.toPNG();
      if (png.byteLength > BROWSER_LIMITS.screenshotMaxBytes) throw new BrowserError("RESULT_TOO_LARGE", "The screenshot exceeds 1 MiB; scroll to a smaller region or use browser_get_text");
      const viewport = this.unwrap(await this.page<{ width: number; height: number }>("viewport", {}));
      return { mimeType: "image/png" as const, width: outWidth, height: outHeight, viewportWidth: viewport.width, viewportHeight: viewport.height, imageBase64: png.toString("base64") };
    });
  }

  /**
   * win32 freshness gate (Issue #42 W2/W7). Called after settleFrames has already resolved; starts the frame
   * subscription and trusts the first bitmap handed to its callback as the presented frame, without calling
   * capturePage() at all. Rejects with SCREENSHOT_UNAVAILABLE if no frame arrives within `timeoutMs`.
   *
   * winfix7: on CI's software compositor a minimized window can keep delivering the *pre-existing* surface
   * to a fresh subscription instead of erroring, so "the first frame handed to the callback" is not always
   * fresh. Electron also reports which region of the frame actually changed via `dirtyRect`; a frame whose
   * dirtyRect is empty (no changed pixels) is treated as a repeat of a stale surface and skipped in favor of
   * the next callback, bounded by the same deadline. A dirtyRect that is missing or not in the expected shape
   * (older Electron versions, or a test fake that only models the image) is *not* treated as empty — it is
   * passed through unchanged, so real desktops and existing fakes keep today's behavior.
   */
  private awaitPresentedFrame(wc: WebContentsLike, timeoutMs: number): Promise<ImageLike> {
    const begin = wc.beginFrameSubscription;
    if (!begin) {
      return Promise.reject(new BrowserError("SCREENSHOT_UNAVAILABLE", "No new frame was presented before the deadline"));
    }
    return new Promise<ImageLike>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        try {
          wc.endFrameSubscription?.();
        } catch {
          /* subscription may already be gone with the page */
        }
      };
      const finishResolve = (image: ImageLike) => {
        if (settled) return;
        cleanup();
        resolve(image);
      };
      const finishReject = (err: unknown) => {
        if (settled) return;
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => finishReject(new BrowserError("SCREENSHOT_UNAVAILABLE", "No new frame was presented before the deadline")), timeoutMs);
      try {
        begin.call(wc, false, (image, dirtyRect) => {
          logScreenshotDebug(image, dirtyRect);
          if (isDirtyRectEmpty(dirtyRect)) return;
          finishResolve(image);
        });
        // winfix7: a best-effort nudge for the compositor to present a new frame now that the subscription
        // is active; harmless if the real desktop already presents on its own (candidate A's primary path).
        try {
          wc.invalidate?.();
        } catch {
          /* optional API; a failure here must not affect the capture */
        }
      } catch {
        finishReject(new BrowserError("SCREENSHOT_UNAVAILABLE", "No new frame was presented before the deadline"));
      }
    });
  }

  private async capturePageWithTimeout(wc: WebContentsLike, timeoutMs: number): Promise<ImageLike> {
    try {
      let timer: NodeJS.Timeout | undefined;
      const limit = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("capture timed out")), timeoutMs); });
      return await Promise.race([wc.capturePage(undefined, { stayHidden: true }), limit]).finally(() => clearTimeout(timer));
    } catch {
      throw new BrowserError("SCREENSHOT_UNAVAILABLE", "The page surface could not be captured");
    }
  }

  wait(run: BrowserRunHandle, args: {
    leaseId: string;
    timeoutMs?: number;
    condition:
      | { kind: "text"; text: string; present: boolean }
      | { kind: "url"; url: string }
      | { kind: "ref"; snapshotId: string; ref: string; state: "visible" | "hidden" | "enabled" }
      | { kind: "load"; state: "domcontentloaded" | "load" };
  }) {
    const condition = args.condition;
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs, snapshotId: condition.kind === "ref" ? condition.snapshotId : undefined }, async (ctx) => {
      const started = this.now();
      for (;;) {
        ctx.check();
        if (await this.conditionMet(condition)) return { matched: true as const, elapsedMs: this.now() - started };
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, POLL_MS);
          ctx.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    });
  }

  /* ------------------------------------------------------------- evaluate */

  /**
   * Settles with `promise`, or with the controller's verdict as soon as the request is cancelled,
   * loses a gate or runs out of time. The underlying executeJavaScript cannot be aborted, so the
   * caller must treat "verdict first" as "the page may still be running" and abandon the view.
   */
  private raceVerdict<T>(ctx: Ctx, gate: () => void, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (action: () => void) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        ctx.signal.removeEventListener("abort", verdict);
        ctx.deadlineSignal.removeEventListener("abort", verdict);
        action();
      };
      const verdict = () => {
        try {
          gate();
          finish(() => reject(new BrowserError("CANCELLED", "The operation was cancelled", { effect: ctx.effect })));
        } catch (error) {
          finish(() => reject(error));
        }
      };
      const poll = setInterval(() => {
        try {
          gate();
        } catch (error) {
          finish(() => reject(error));
        }
      }, 50);
      ctx.signal.addEventListener("abort", verdict, { once: true });
      ctx.deadlineSignal.addEventListener("abort", verdict, { once: true });
      if (ctx.signal.aborted || ctx.deadlineSignal.aborted) return verdict();
      promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      );
    });
  }

  evaluate(run: BrowserRunHandle, args: { leaseId: string; documentEpoch: number; script: string; frameId?: string; timeoutMs?: number }): Promise<BrowserResult<BrowserEvaluateResult>> {
    return this.run(run, args.leaseId, { timeoutMs: args.timeoutMs, sharedDeadline: true, documentEpoch: args.documentEpoch }, async (ctx) => {
      const gate = () => {
        if (ctx.signal.aborted) {
          // The most specific reason wins (e.g. the user took over), with the effect known so far.
          try {
            this.ownership.assertLease(run.runId, args.leaseId);
          } catch (error) {
            if (error instanceof BrowserError && error.code === "USER_INTERRUPTED") throw new BrowserError(error.code, error.message, { effect: ctx.effect });
          }
        }
        ctx.check();
        if (!this.evaluateEnabled) throw new BrowserError("EVALUATE_DISABLED", "Page JavaScript execution is disabled in settings", { effect: ctx.effect });
      };
      gate();
      const epochs = this.ownership.epochs;
      if (epochs.documentEpoch !== args.documentEpoch) throw new BrowserError("STALE_DOCUMENT", "The page changed since documentEpoch was observed; read the current state first");
      checkScriptSyntax(args.script);
      const wc = this.liveContents();
      if (!wc) throw new BrowserError("PAGE_CRASHED", "The page is not available");
      const context = { viewEpoch: epochs.viewEpoch, ownershipEpoch: epochs.ownershipEpoch, documentEpoch: epochs.documentEpoch };
      const tracker = this.frames;
      const root = wc.mainFrame;

      let frame: FrameLike;
      let generation: number;
      let frameId: string;
      if (args.frameId !== undefined) {
        ({ frame, generation } = tracker.resolve(args.frameId, root, context));
        frameId = args.frameId;
      } else {
        frame = root;
        generation = tracker.generation(root.frameTreeNodeId);
        if (!isHttpOrigin(root.origin)) throw new BrowserError("UNSUPPORTED_TARGET", "Only http(s) pages can run scripts");
        frameId = tracker.issue(root, context);
      }
      /** The target is still exactly the document we validated (view, ownership, top document, frame generation). */
      const sameTarget = () => {
        const now = this.ownership.epochs;
        if (now.viewEpoch !== context.viewEpoch || now.ownershipEpoch !== context.ownershipEpoch || now.documentEpoch !== context.documentEpoch) return false;
        if (tracker.generation(frame.frameTreeNodeId) !== generation) return false;
        try {
          return !frame.detached && frame.processId !== undefined && isHttpOrigin(frame.origin);
        } catch {
          return false;
        }
      };
      const staleError = (effect: Ctx["effect"]) =>
        new BrowserError(args.frameId !== undefined ? "STALE_FRAME" : "STALE_DOCUMENT", "The page or frame changed while the script was being prepared; take a new browser_snapshot", { effect });

      // Step 1 (Main-authored code only, effect none): put a random token into the CURRENT document.
      const token = await this.raceVerdict(ctx, gate, this.executeInFrame(frame, buildTokenProgram(this.evaluateKey, randomBytes(12).toString("hex")), staleError("none")));
      gate();
      if (typeof token !== "string" || token.length === 0) throw new BrowserError("INTERNAL_ERROR", "The page could not be prepared for script execution");
      // A navigation that started after we validated (and before this reply) bumped the generation, so
      // the token cannot belong to a newer document: any exec that landed there would imply a prior start event.
      if (!sameTarget()) throw staleError("none");

      // Step 2: deliver once. The token guard inside the program refuses a document that replaced the validated one.
      const program = buildEvaluateProgram({ script: args.script, key: this.evaluateKey, token });
      let settled = false;
      ctx.effect = "possible";
      this.viewHadEvaluate = true;
      this.latestSnapshot = null;
      const delivery = this.executeInFrame(frame, program, staleError("possible"));
      delivery.then(() => (settled = true), () => (settled = true));
      try {
        const raw = await this.raceVerdict(ctx, gate, delivery);
        const envelope = parseEnvelope(raw);
        if (envelope.kind === "guard") {
          ctx.effect = "none"; // the guard proves the script never started
          throw staleError("none");
        }
        gate();
        if (!sameTarget()) throw staleError("possible");
        const value = envelopeToValue(envelope);
        const origin = (() => {
          try {
            return { url: frame.url, origin: frame.origin };
          } catch {
            return { url: "", origin: "" };
          }
        })();
        return { frameId, frameUrl: origin.url.slice(0, BROWSER_LIMITS.frameUrlMaxChars), frameOrigin: origin.origin.slice(0, BROWSER_LIMITS.frameUrlMaxChars), value };
      } catch (error) {
        // Verdict before the page answered (timeout / cancel / gate lost): the script may still be running.
        if (!settled) this.abandonView("ページ内スクリプトが完了しなかったため、ページを閉じました");
        throw error;
      }
    });
  }

  /** Page-side failures (frame disposed/navigated mid-flight) become the given error; details are not forwarded. */
  private executeInFrame(frame: FrameLike, code: string, onFailure: BrowserError): Promise<unknown> {
    try {
      return frame.executeJavaScript(code, false).catch(() => {
        throw onFailure;
      });
    } catch {
      return Promise.reject(onFailure);
    }
  }

  private async conditionMet(condition: Parameters<EmbeddedBrowserController["wait"]>[1]["condition"]): Promise<boolean> {
    const wc = this.liveContents();
    if (!wc) throw new BrowserError("PAGE_CRASHED", "The page is not available");
    switch (condition.kind) {
      case "url":
        return wc.getURL() === condition.url;
      case "load": {
        if (wc.isLoading()) return false;
        const state = this.unwrap(await this.page<{ readyState: string }>("viewport", {}));
        return condition.state === "load" ? state.readyState === "complete" : state.readyState !== "loading";
      }
      case "text": {
        if (wc.isLoading()) return false;
        const out = this.unwrap(await this.page<{ present: boolean }>("hasText", { text: condition.text }));
        return out.present === condition.present;
      }
      case "ref": {
        this.assertSnapshot(condition.snapshotId);
        const out = this.unwrap(await this.page<{ matched: boolean }>("checkRef", { snapshotId: condition.snapshotId, ref: condition.ref, state: condition.state }));
        return out.matched;
      }
    }
  }
}
