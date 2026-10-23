import { ipcMain } from "electron";
import type { AppUpdateService } from "../app-update-service";

export function registerAppUpdateIpcHandlers(service: AppUpdateService): void {
  ipcMain.handle("app-update:get-state", () => service.getSnapshot());
  ipcMain.handle("app-update:check", () => service.check("manual"));
  ipcMain.handle("app-update:download", () => service.download());
  ipcMain.handle("app-update:install", () => service.install());
}
