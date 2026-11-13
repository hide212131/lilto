import { BrowserWindow, powerMonitor, session, shell, WebContentsView } from "electron";

import type { BrowserHost, EmbeddedBrowserController, ViewLike } from "./embedded-browser";

/** Page surface partition (in-memory, shared by the one embedded view; never the host's session). */
export const BROWSER_PARTITION = "lilto-links";

let hardenedSession: Electron.Session | null = null;

/** Default-deny permissions, cancel downloads. Applied once per Session object. */
function hardenSession(): Electron.Session {
  const ses = session.fromPartition(BROWSER_PARTITION);
  if (hardenedSession === ses) return ses;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  hardenedSession = ses;
  return ses;
}

export function createElectronBrowserHost(getWindow: () => BrowserWindow | null): BrowserHost {
  // Captured only while not minimized, where getContentBounds()/getBounds() are both trustworthy;
  // reused to turn getNormalBounds() (reliable even while minimized) into a content-size estimate.
  let chromeOffset: { width: number; height: number } | null = null;
  return {
    createView(): ViewLike {
      hardenSession();
      const view = new WebContentsView({
        webPreferences: {
          partition: BROWSER_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          disableDialogs: true
          // No preload: nothing from Lilto (window.lilto, IPC, tokens) reaches the page.
        }
      });
      view.webContents.setZoomFactor(1);
      void view.webContents.setVisualZoomLevelLimits(1, 1);
      return view as unknown as ViewLike;
    },
    attachView(view) {
      getWindow()?.contentView.addChildView(view as unknown as WebContentsView);
    },
    detachView(view) {
      getWindow()?.contentView.removeChildView(view as unknown as WebContentsView);
    },
    getContentSize() {
      const window = getWindow();
      if (!window || window.isDestroyed()) return { width: 0, height: 0 };
      const bounds = window.getContentBounds();
      if (!window.isMinimized() && bounds.width > 0 && bounds.height > 0) {
        const outer = window.getBounds();
        chromeOffset = { width: Math.max(0, outer.width - bounds.width), height: Math.max(0, outer.height - bounds.height) };
      }
      return { width: bounds.width, height: bounds.height };
    },
    getNormalContentSize() {
      const window = getWindow();
      if (!window || window.isDestroyed() || !chromeOffset) return null;
      const normal = window.getNormalBounds();
      return { width: normal.width - chromeOffset.width, height: normal.height - chromeOffset.height };
    },
    getZoomFactor() {
      return getWindow()?.webContents.getZoomFactor() ?? 1;
    },
    getWindowState() {
      const window = getWindow();
      if (!window || window.isDestroyed()) return { present: false, visible: false, minimized: false, focused: false };
      return { present: true, visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() };
    },
    setHostBackgroundThrottling(allowed) {
      const window = getWindow();
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.setBackgroundThrottling(allowed);
    },
    sendToRenderer(channel, payload) {
      const window = getWindow();
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
    },
    openExternal(url) {
      void shell.openExternal(url);
    },
    async clearSessionData() {
      const ses = session.fromPartition(BROWSER_PARTITION);
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    },
    focusHost() {
      getWindow()?.webContents.focus();
    }
  };
}

/**
 * Explicit hide (close button => tray). Goes through the controller first so a hide always ends the lease,
 * even when the hide event cannot be told apart from a minimize on some platform.
 */
export function hideWindowExplicitly(controller: EmbeddedBrowserController | null, window: BrowserWindow): void {
  controller?.onWindowHidden();
  window.hide();
}

/** Keep the controller in sync with the window (geometry, zoom, hide/minimize, renderer reloads). */
export function attachControllerToWindow(controller: EmbeddedBrowserController, window: BrowserWindow): void {
  const relayout = () => controller.onWindowGeometryChanged();
  window.on("resize", relayout);
  window.on("maximize", relayout);
  window.on("unmaximize", relayout);
  window.on("enter-full-screen", relayout);
  window.on("leave-full-screen", relayout);
  // A minimize is not a hide: the lease, the view and the layout survive it (Issue #42).
  window.on("hide", () => {
    if (!window.isMinimized()) controller.onWindowHidden();
  });
  window.on("minimize", () => controller.onWindowMinimized());
  window.on("show", () => controller.onWindowShown());
  window.on("restore", () => controller.onWindowRestored());
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) controller.beginRendererEpoch();
  });
  window.webContents.on("zoom-changed", relayout);
  window.webContents.on("render-process-gone", () => controller.beginRendererEpoch());
}

/** Screen lock / suspend end operations and the lease (design 6.3). Returns the cleanup. */
export function attachControllerToPowerMonitor(controller: EmbeddedBrowserController): () => void {
  const handlers: Array<[string, () => void]> = [
    ["lock-screen", () => controller.onSystemLocked()],
    ["unlock-screen", () => controller.onSystemUnlocked()],
    ["suspend", () => controller.onSystemSuspend()],
    ["resume", () => controller.onSystemResume()]
  ];
  for (const [event, handler] of handlers) powerMonitor.on(event as "suspend", handler);
  return () => {
    for (const [event, handler] of handlers) powerMonitor.removeListener(event as "suspend", handler);
  };
}
