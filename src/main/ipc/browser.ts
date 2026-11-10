import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import type { BrowserIpcResult } from "../../shared/browser";
import { parseViewportUpdate } from "../browser-bounds";
import type { EmbeddedBrowserController } from "../embedded-browser";

function fromHost(event: IpcMainInvokeEvent, getWindow: () => BrowserWindow | null): boolean {
  const window = getWindow();
  if (!window || window.isDestroyed()) return false;
  return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}

const reject = (message: string): BrowserIpcResult<never> => ({ ok: false, error: { code: "INVALID_REQUEST", message } });

/** Registers browser IPC. Every handler only accepts the host window's main frame. */
export function registerBrowserIpcHandlers(controller: EmbeddedBrowserController, getWindow: () => BrowserWindow | null): void {
  // Wraps a handler: sender check, error mapping, and a uniform `{ ok, state }` reply.
  const guard = (run: (payload: unknown) => Promise<void> | void) =>
    async (event: IpcMainInvokeEvent, payload?: unknown): Promise<BrowserIpcResult> => {
      if (!fromHost(event, getWindow)) return reject("untrusted sender");
      try {
        await run(payload);
        return { ok: true, state: controller.getState() };
      } catch (error) {
        return { ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "error" } };
      }
    };

  ipcMain.handle("browser:getState", guard(() => undefined));
  ipcMain.handle("browser:setPresentation", (event, payload: unknown): BrowserIpcResult => {
    if (!fromHost(event, getWindow)) return reject("untrusted sender");
    const p = payload as { open?: unknown; occluded?: unknown; resizing?: unknown } | null;
    if (!p || typeof p.open !== "boolean" || typeof p.occluded !== "boolean" || typeof p.resizing !== "boolean") return reject("invalid presentation");
    controller.setPresentation({ open: p.open, occluded: p.occluded, resizing: p.resizing });
    return { ok: true, state: controller.getState() };
  });
  ipcMain.handle("browser:updateViewport", (event, payload: unknown): BrowserIpcResult => {
    if (!fromHost(event, getWindow)) return reject("untrusted sender");
    const update = parseViewportUpdate(payload);
    if (!update) return reject("invalid viewport");
    controller.updateViewport(update);
    return { ok: true, state: controller.getState() };
  });
  ipcMain.handle("browser:navigate", guard(async (payload) => {
    const url = payload && typeof payload === "object" ? (payload as { url?: unknown }).url : undefined;
    await controller.navigateByUser(typeof url === "string" ? url : "");
  }));
  ipcMain.handle("browser:back", guard(() => controller.goBack()));
  ipcMain.handle("browser:forward", guard(() => controller.goForward()));
  ipcMain.handle("browser:reload", guard(() => controller.reloadByUser()));
  // No URL argument is read: the controller opens its own current URL.
  ipcMain.handle("browser:openExternal", guard(() => controller.openCurrentExternally()));
  ipcMain.handle("browser:takeControl", guard(() => controller.takeControl()));
  ipcMain.handle("browser:allowAgentControl", guard(() => controller.allowAgentControl()));
}
