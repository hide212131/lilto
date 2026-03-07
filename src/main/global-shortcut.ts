import { globalShortcut, BrowserWindow } from "electron";
import { createLogger } from "./logger";

const logger = createLogger("global-shortcut");
let currentAccelerator = "";

export function registerAppShortcut(
  accelerator: string,
  getWindow: () => BrowserWindow | null
): void {
  if (currentAccelerator) {
    try {
      globalShortcut.unregister(currentAccelerator);
    } catch (error) {
      logger.error("shortcut_unregister_failed", { accelerator: currentAccelerator, error: String(error) });
    }
    currentAccelerator = "";
  }

  if (!accelerator) return;

  try {
    const registered = globalShortcut.register(accelerator, () => {
      const win = getWindow();
      if (!win) return;
      if (win.isMinimized()) {
        win.restore();
      } else if (!win.isVisible()) {
        win.show();
      }
      win.focus();
      win.webContents.send("app:focusComposer");
    });

    if (registered) {
      currentAccelerator = accelerator;
      logger.info("shortcut_registered", { accelerator });
    } else {
      logger.error("shortcut_register_failed", { accelerator, reason: "already_registered_or_unavailable" });
    }
  } catch (error) {
    logger.error("shortcut_register_error", { accelerator, error: String(error) });
  }
}

export function unregisterAppShortcut(): void {
  if (currentAccelerator) {
    try {
      globalShortcut.unregister(currentAccelerator);
      logger.info("shortcut_unregistered", { accelerator: currentAccelerator });
    } catch (error) {
      logger.error("shortcut_unregister_failed", { accelerator: currentAccelerator, error: String(error) });
    }
    currentAccelerator = "";
  }
}
