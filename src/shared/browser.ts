/** Shared contracts for the embedded browser (IPC, state, errors, limits). */

export const BROWSER_MCP_SERVER_ID = "lilto_browser";
export const BROWSER_MCP_SERVER_NAME = "lilto-browser";
export const BROWSER_MCP_PROTOCOL_VERSION = "2025-06-18";

export const BROWSER_PANEL_WIDTH_KEY = "lilto-browser-panel-width.v1";
export const BROWSER_PANEL_DEFAULT_WIDTH = 480;
export const BROWSER_PANEL_MIN_WIDTH = 320;
export const BROWSER_PANEL_MAX_WIDTH = 960;
export const BROWSER_CHAT_MIN_WIDTH = 320;
export const BROWSER_PANEL_KEY_STEP = 16;

export const BROWSER_LIMITS = {
  idMaxLength: 128,
  urlMaxLength: 8192,
  timeoutMinMs: 100,
  timeoutMaxMs: 30_000,
  timeoutDefaultMs: 10_000,
  fillMaxChars: 16_384,
  selectMaxValues: 100,
  selectValueMaxChars: 1024,
  scrollDeltaMax: 4000,
  textMaxChars: 32_768,
  textDefaultChars: 16_384,
  snapshotMaxNodes: 2000,
  snapshotDefaultNodes: 500,
  waitTextMaxChars: 2048,
  screenshotMaxEdge: 1280,
  screenshotMaxBytes: 1024 * 1024,
  bridgeRequestMaxBytes: 64 * 1024,
  bridgeResponseMaxBytes: 2 * 1024 * 1024,
  snapshotTtlMs: 60_000,
  evaluateScriptMaxChars: 16_384,
  evaluateScriptMaxBytes: 16 * 1024,
  evaluateResultMaxBytes: 64 * 1024,
  evaluateMaxDepth: 32,
  evaluateMaxValues: 10_000,
  evaluateMessageMaxChars: 300,
  frameListMax: 128,
  frameListMaxBytes: 64 * 1024,
  frameUrlMaxChars: 2048,
  frameNameMaxChars: 128,
  frameIdTtlMs: 60_000
} as const;

export const BROWSER_ERROR_CODES = [
  "BROWSER_DISABLED",
  "BROWSER_UNAVAILABLE",
  "BROWSER_BUSY",
  "BROWSER_NOT_OWNED",
  "LEASE_EXPIRED",
  "PANEL_CLOSED",
  "PANEL_OCCLUDED",
  "PANEL_NOT_READY",
  "SYSTEM_LOCKED",
  "SYSTEM_SUSPENDED",
  "SCREENSHOT_UNAVAILABLE",
  "WINDOW_NOT_FOCUSED",
  "USER_INTERRUPTED",
  "STALE_REF",
  "ELEMENT_NOT_INTERACTABLE",
  "UNSUPPORTED_TARGET",
  "NAVIGATION_BLOCKED",
  "NAVIGATION_FAILED",
  "TIMEOUT",
  "CANCELLED",
  "RESULT_TOO_LARGE",
  "PAGE_CRASHED",
  "EVALUATE_DISABLED",
  "STALE_DOCUMENT",
  "STALE_FRAME",
  "SCRIPT_SYNTAX_ERROR",
  "SCRIPT_EXECUTION_ERROR",
  "RESULT_NOT_SERIALIZABLE",
  "INTERNAL_ERROR"
] as const;
export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];

export type BrowserEffect = "none" | "possible" | "applied";

export type BrowserToolState = {
  url: string;
  title: string;
  documentEpoch: number;
  /** The panel is shown to the user: view displayed and the host window neither hidden nor minimized. */
  panelVisible: boolean;
  /** Tools can operate on the page now (panel requested, view prepared, environment gate open), even while minimized. */
  operationReady: boolean;
  windowMinimized: boolean;
  loading: boolean;
};

export type BrowserToolError = {
  code: BrowserErrorCode;
  message: string;
  retryable: boolean;
  effect: BrowserEffect;
};

export type BrowserResult<T> =
  | { ok: true; state: BrowserToolState; result: T }
  | { ok: false; error: BrowserToolError };

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  readonly retryable: boolean;
  readonly effect: BrowserEffect;
  constructor(code: BrowserErrorCode, message: string, options: { retryable?: boolean; effect?: BrowserEffect } = {}) {
    super(message);
    this.name = "BrowserError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.effect = options.effect ?? "none";
  }
  toJSON(): BrowserToolError {
    return { code: this.code, message: this.message, retryable: this.retryable, effect: this.effect };
  }
}

export type BrowserSnapshotNode = {
  ref: string;
  parentRef: string | null;
  role: string;
  name: string;
  text?: string;
  value?: string;
  states: {
    disabled?: boolean;
    checked?: boolean | "mixed";
    expanded?: boolean;
    selected?: boolean;
    readonly?: boolean;
    password?: boolean;
  };
  actionable: boolean;
  unsupportedReason?: string;
};

/** One frame of the current view, as enumerated by Main (never page-supplied). */
export type BrowserFrameInfo = {
  frameId: string;
  parentFrameId: string | null;
  url: string;
  origin: string;
  name: string;
  isMainFrame: boolean;
  evaluable: boolean;
  unsupportedReason?: string;
};

export type BrowserJsonValue = null | boolean | number | string | BrowserJsonValue[] | { [key: string]: BrowserJsonValue };

export type BrowserEvaluateResult = {
  frameId: string;
  frameUrl: string;
  frameOrigin: string;
  value: { type: "undefined" } | { type: "json"; value: BrowserJsonValue };
};

export type BrowserSnapshot = {
  format: "dom-v1";
  snapshotId: string;
  documentEpoch: number;
  viewport: { width: number; height: number };
  nodes: BrowserSnapshotNode[];
  text: string;
  truncated: boolean;
  limitations: string[];
  /** Present only while browserSettings.evaluateEnabled is true. */
  frames?: BrowserFrameInfo[];
  framesTruncated?: boolean;
};

export type BrowserOwnerView = null | { kind: "user" } | { kind: "agent"; conversationId: string };

/** Renderer-visible state. Never contains tokens or lease ids. */
export type BrowserPanelState = {
  revision: number;
  enabled: boolean;
  autoOpenOnToolUse: boolean;
  /** Panel is requested open by the user or by an auto-open. */
  panelRequested: boolean;
  /** The native view is shown to the user (false while the window is minimized or hidden). */
  panelVisible: boolean;
  /** Tools can operate on the page (may be true while panelVisible is false, e.g. minimized). */
  operationReady: boolean;
  /** The host window is minimized, as observed by Main. */
  windowMinimized: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  owner: BrowserOwnerView;
  lastOwnerConversationId: string | null;
  error: string | null;
  layoutRevision: number;
  rendererEpoch: string;
};

export type BrowserViewportUpdate = {
  rendererEpoch: string;
  seq: number;
  layoutRevision: number;
  viewport: { x: number; y: number; width: number; height: number };
  hostViewport: { width: number; height: number };
  panelOpen: boolean;
  occluded: boolean;
  resizing: boolean;
};

export type BrowserPresentation = { open: boolean; occluded: boolean; resizing: boolean };

export type BrowserIpcResult<T = BrowserPanelState> =
  | { ok: true; state: T }
  | { ok: false; error: { code: string; message: string } };

export const BROWSER_IPC = {
  getState: "browser:getState",
  setPresentation: "browser:setPresentation",
  updateViewport: "browser:updateViewport",
  navigate: "browser:navigate",
  back: "browser:back",
  forward: "browser:forward",
  reload: "browser:reload",
  openExternal: "browser:openExternal",
  takeControl: "browser:takeControl",
  allowAgentControl: "browser:allowAgentControl",
  stateChanged: "browser:stateChanged"
} as const;

/** Only complete http(s) URLs without credentials may be navigated to. */
export function parseBrowsableUrl(input: unknown): URL | null {
  if (typeof input !== "string" || input.length === 0 || input.length > BROWSER_LIMITS.urlMaxLength) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
