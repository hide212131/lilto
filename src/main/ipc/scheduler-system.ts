import fs from "node:fs";
import path from "node:path";

import { BrowserWindow, ipcMain, shell } from "electron";

import { isHeartbeatInternalScheduleId } from "../heartbeat-assistant";
import type { NotificationService } from "../notifications";
import type { SchedulerClient } from "../scheduler";
import type { SpeechTranscriptionService } from "../speech-transcription";
import type { WindowsSandboxSetupService } from "../windows-sandbox-setup";
import { openConversationWindow } from "./utils";

export function registerSchedulerSystemIpcHandlers({
  scheduler,
  notificationService,
  speechTranscriptionService,
  windowsSandboxSetupService,
  agentsFilePath
}: {
  scheduler: SchedulerClient;
  notificationService: NotificationService;
  speechTranscriptionService: SpeechTranscriptionService;
  windowsSandboxSetupService: WindowsSandboxSetupService;
  agentsFilePath: string;
}): void {
  ipcMain.handle("scheduler:list", async () => {
    try {
      const schedules = await scheduler.listSchedules();
      return {
        ok: true as const,
        schedules: schedules.filter((schedule) => !isHeartbeatInternalScheduleId(schedule.id))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : "SCHEDULER_LIST_FAILED";
      return { ok: false as const, error: { code, message } };
    }
  });

  ipcMain.handle("scheduler:delete", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "id は必須です" }
      };
    }

    try {
      await scheduler.deleteSchedule((payload as { id: string }).id);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : "SCHEDULER_DELETE_FAILED";
      return { ok: false as const, error: { code, message } };
    }
  });

  ipcMain.handle("scheduler:showNotification", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { message?: unknown }).message !== "string") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "message は必須です" }
      };
    }

    const message = (payload as { message: string }).message.trim();
    const conversationId =
      typeof (payload as { conversationId?: unknown }).conversationId === "string"
        ? (payload as { conversationId: string }).conversationId.trim()
        : "";
    if (!message) {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "message は空にできません" }
      };
    }

    if (BrowserWindow.getFocusedWindow() === null) {
      notificationService.notify("lilto - スケジュール通知", message, {
        onClick: () => {
          if (!conversationId) {
            return;
          }
          openConversationWindow(conversationId);
        }
      });
      notificationService.incrementBadge();
    }
    return { ok: true as const };
  });

  ipcMain.handle("windowsSandbox:setup", async (_event, payload: unknown) => {
    const mode =
      payload &&
      typeof payload === "object" &&
      (((payload as { mode?: unknown }).mode === "elevated") || ((payload as { mode?: unknown }).mode === "unelevated"))
        ? (payload as { mode: "elevated" | "unelevated" }).mode
        : null;

    if (!mode) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_REQUEST",
          message: "mode は elevated または unelevated を指定してください。",
          retryable: false
        }
      };
    }

    return await windowsSandboxSetupService.runSetup(mode);
  });

  ipcMain.handle("audio:transcribe", async (_event, payload: unknown) => {
    const audioData =
      payload &&
      typeof payload === "object" &&
      (payload as { audioData?: unknown }).audioData instanceof Uint8Array
        ? (payload as { audioData: Uint8Array }).audioData
        : payload &&
            typeof payload === "object" &&
            (payload as { audioData?: unknown }).audioData instanceof ArrayBuffer
          ? new Uint8Array((payload as { audioData: ArrayBuffer }).audioData)
          : null;

    if (!audioData) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_REQUEST",
          message: "audioData は必須です。",
          retryable: false
        }
      };
    }

    if (process.env.LILTO_E2E_MOCK === "1") {
      return {
        ok: false as const,
        error: {
          code: "NO_SPEECH",
          message: "No speech detected",
          retryable: false
        }
      };
    }

    return await speechTranscriptionService.transcribeWav(audioData);
  });

  ipcMain.handle("audio:startNativeDictation", async () => {
    return await speechTranscriptionService.startNativeDictation();
  });

  ipcMain.handle("audio:finishNativeDictation", async () => {
    return await speechTranscriptionService.finishNativeDictation();
  });

  ipcMain.handle("audio:cancelNativeDictation", async () => {
    await speechTranscriptionService.cancelNativeDictation();
    return { ok: true as const };
  });

  ipcMain.handle("app:getAgentsFile", () => {
    return {
      ok: true as const,
      path: agentsFilePath,
      exists: fs.existsSync(agentsFilePath)
    };
  });

  ipcMain.handle("app:openAgentsFile", async () => {
    try {
      fs.mkdirSync(path.dirname(agentsFilePath), { recursive: true });
      const exists = fs.existsSync(agentsFilePath);
      if (!exists) {
        fs.writeFileSync(
          agentsFilePath,
          "# AGENTS.md\n\n## Project Instructions\n\n- Add project-specific instructions here.\n",
          "utf8"
        );
      }
      const errorMessage = await shell.openPath(agentsFilePath);
      if (errorMessage) {
        return { ok: false as const, error: { code: "OPEN_FAILED", message: errorMessage }, path: agentsFilePath };
      }
      return { ok: true as const, path: agentsFilePath, created: !exists };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, error: { code: "OPEN_FAILED", message }, path: agentsFilePath };
    }
  });

  ipcMain.handle("app:openExternal", async (_event, payload: unknown) => {
    const url = typeof payload === "object" && payload && typeof (payload as { url?: unknown }).url === "string"
      ? (payload as { url: string }).url
      : null;

    if (!url) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "url は必須です" } };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, error: { code: "INVALID_URL", message: "url の形式が不正です" } };
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { ok: false, error: { code: "UNSUPPORTED_PROTOCOL", message: "http/https のみサポートします" } };
    }

    await shell.openExternal(parsedUrl.toString());
    return { ok: true };
  });
}
