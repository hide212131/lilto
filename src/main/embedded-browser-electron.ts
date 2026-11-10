import { BrowserWindow, session, shell, WebContentsView } from "electron";

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
      const bounds = getWindow()?.getContentBounds();
      return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
    },
    getZoomFactor() {
      return getWindow()?.webContents.getZoomFactor() ?? 1;
    },
    isWindowVisible() {
      const window = getWindow();
      return Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized());
    },
    isWindowFocused() {
      return Boolean(getWindow()?.isFocused());
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

/** Keep the controller in sync with the window (geometry, zoom, hide/minimize, renderer reloads). */
export function attachControllerToWindow(controller: EmbeddedBrowserController, window: BrowserWindow): void {
  const relayout = () => controller.onWindowGeometryChanged();
  window.on("resize", relayout);
  window.on("maximize", relayout);
  window.on("unmaximize", relayout);
  window.on("enter-full-screen", relayout);
  window.on("leave-full-screen", relayout);
  window.on("hide", () => controller.onWindowHidden());
  window.on("minimize", () => controller.onWindowHidden());
  window.on("show", () => controller.onWindowShown());
  window.on("restore", () => controller.onWindowShown());
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) controller.beginRendererEpoch();
  });
  window.webContents.on("zoom-changed", relayout);
  window.webContents.on("render-process-gone", () => controller.beginRendererEpoch());
}
