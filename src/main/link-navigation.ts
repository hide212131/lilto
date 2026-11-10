import type { BrowserWindow } from "electron";

import { parseBrowsableUrl } from "../shared/browser";

/** The only part of the controller the link adapter needs. */
export type LinkTarget = { openLinkFromHost(url: string): void };

/**
 * Keep the chat page in place and send http(s) links to the embedded browser panel
 * (or the external browser when the feature is OFF — the controller decides).
 * Everything else is refused. No views are created here.
 */
export function installLinkNavigation(window: BrowserWindow, target: LinkTarget): void {
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (parseBrowsableUrl(url)) target.openLinkFromHost(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (parseBrowsableUrl(url)) target.openLinkFromHost(url);
    return { action: "deny" };
  });
}
