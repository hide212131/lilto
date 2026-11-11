import type { PromptImage } from "../../shared/prompt-images";
import { randomUUID } from "node:crypto";

import { BrowserWindow, ipcMain } from "electron";

import type { AgentRuntime } from "../agent-sdk";
import { ConversationHistoryService } from "../conversation-history";
import { validatePrompt } from "../ipc-contract";
import { createLogger } from "../logger";
import type { NotificationService } from "../notifications";
import { normalizePluginMentionsForPrompt } from "../plugin-mentions";
import { isHeartbeatAssistantSessionId } from "../../shared/heartbeat-assistant";
import type { PluginService } from "../plugin-service";
import type { ProviderSettingsService } from "../provider-settings";
import type { SchedulerClient } from "../scheduler";
import { broadcastLoopEvent, openConversationWindow } from "./utils";

async function normalizePromptPluginMentions(text: string, pluginService: PluginService): Promise<string> {
  if (!text.includes("@")) {
    return text;
  }

  const plugins = await pluginService.listPlugins({ forceRemoteSync: false });
  if (!plugins.ok) {
    return text;
  }

  return normalizePluginMentionsForPrompt(text, plugins.state.marketplacePlugins);
}

export function registerAgentConversationIpcHandlers({
  agentRuntime,
  providerSettingsService,
  notificationService,
  pluginService,
  conversationHistory,
  scheduler
}: {
  agentRuntime: AgentRuntime;
  providerSettingsService: ProviderSettingsService;
  notificationService: NotificationService;
  pluginService: PluginService;
  conversationHistory: ConversationHistoryService;
  scheduler: SchedulerClient;
}): void {
  const logger = createLogger("ipc");
  const preparingRuns = new Map<string, { aborted: boolean; ready: Promise<void>; resolve: () => void }>();

  ipcMain.handle("agent:steerPrompt", async (_event, payload: unknown) => {
    const validation = validatePrompt(payload);
    if (!validation.ok) return { ok: false, error: validation };
    const { text, conversationId } = payload as { text: string; conversationId?: string };
    if (!conversationId) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "conversationId は必須です" } };
    }
    const preparing = preparingRuns.get(conversationId);
    const normalized = await normalizePromptPluginMentions(text, pluginService);
    if (preparing) {
      await preparing.ready;
      if (preparing.aborted || preparingRuns.get(conversationId) !== preparing) {
        return { ok: false, error: { code: "NO_ACTIVE_TURN", message: "実行が終了したか、中断されました。再送信してください。" } };
      }
    }
    return agentRuntime.steerPrompt(normalized, conversationId, (payload as { images?: PromptImage[] }).images);
  });

  ipcMain.handle("agent:submitPrompt", async (_event, payload: unknown) => {
    const validation = validatePrompt(payload);
    if (!validation.ok) {
      logger.error("submit_prompt_invalid", validation);
      return { ok: false, error: validation };
    }

    const originalText = (payload as { text: string }).text;
    const conversationId =
      typeof (payload as { conversationId?: unknown }).conversationId === "string"
        ? (payload as { conversationId: string }).conversationId
        : undefined;
    const backendSessionId =
      typeof (payload as { backendSessionId?: unknown }).backendSessionId === "string"
        ? (payload as { backendSessionId: string }).backendSessionId
        : undefined;
    const silent = typeof (payload as { silent?: unknown }).silent === "boolean"
      ? (payload as { silent: boolean }).silent
      : false;
    const freshContext = typeof (payload as { freshContext?: unknown }).freshContext === "boolean"
      ? (payload as { freshContext: boolean }).freshContext
      : false;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const preparation = { aborted: false, ready, resolve: resolveReady };
    if (!silent && conversationId) {
      if (preparingRuns.has(conversationId)) {
        return { ok: false, error: { code: "CONVERSATION_BUSY", message: "この会話は実行中です。追加指示として送信してください。" } };
      }
      preparingRuns.set(conversationId, preparation);
    }
    const requestId = randomUUID();
    if (!silent) {
      broadcastLoopEvent({ type: "run_start", requestId, conversationId });
    }
    try {
      // Abort can settle the invoke even if plugin discovery is still pending.
      const text = await Promise.race([
        normalizePromptPluginMentions(originalText, pluginService),
        preparation.ready.then(() => originalText)
      ]);
      if (preparation.aborted) {
        const error = { code: "ABORTED", message: "中断しました" };
        if (!silent) broadcastLoopEvent({ type: "run_end", requestId, status: "aborted" });
        return { ok: false, requestId, error };
      }
      const providerSettings = providerSettingsService.getState();
      const response = agentRuntime.submitPrompt(text, providerSettings, {
        images: (payload as { images?: PromptImage[] }).images,
        requestId,
        conversationId,
        backendSessionId,
        freshContext,
        onLoopEvent: (event) => {
          if (!silent) {
            broadcastLoopEvent(event);
          }
        }
      });
      preparation.resolve();
      const result = await response;
      if (!result.ok) {
        if (!silent) {
          broadcastLoopEvent({
            type: "run_end",
            requestId,
            status: result.error.code === "ABORTED" ? "aborted" : "failed",
            errorMessage: `${result.error.code}: ${result.error.message}`
          });
        }
        return { ...result, requestId };
      }

      if (!silent) {
        broadcastLoopEvent({ type: "run_end", requestId, status: "completed" });
      }

      if (!silent && BrowserWindow.getFocusedWindow() === null) {
        const preview = result.text.length > 80 ? `${result.text.slice(0, 77)}…` : result.text;
        notificationService.notify("lilto - 返答が届きました", preview, {
          onClick: () => {
            if (conversationId) {
              openConversationWindow(conversationId);
            }
          }
        });
        notificationService.incrementBadge();
      }

      return {
        ok: true,
        requestId,
        request: { text: originalText },
        response: { text: result.text }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!silent) {
        broadcastLoopEvent({ type: "run_end", requestId, status: "failed", errorMessage: message });
      }
      throw error;
    } finally {
      preparation.resolve();
      if (conversationId && preparingRuns.get(conversationId) === preparation) preparingRuns.delete(conversationId);
    }
  });

  ipcMain.handle("agent:abort", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { conversationId?: unknown }).conversationId !== "string"
      || !(payload as { conversationId: string }).conversationId.trim()) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "conversationId は必須です" } };
    }
    const conversationId = (payload as { conversationId: string }).conversationId;
    const preparing = preparingRuns.get(conversationId);
    if (preparing) {
      preparing.aborted = true;
      preparing.resolve();
    }
    agentRuntime.abort(conversationId);
    return { ok: true };
  });

  ipcMain.handle("conversations:list", async () => {
    try {
      const conversations = await conversationHistory.listConversations();
      return { ok: true, conversations };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: "CONVERSATIONS_LIST_FAILED", message } };
    }
  });

  ipcMain.handle("conversations:read", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { conversationId?: unknown }).conversationId !== "string") {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "conversationId は必須です" } };
    }
    const page = (payload as { page?: import("../../shared/conversation-history-window").HistoryPageRequest }).page;
    if (page !== undefined && (!page || typeof page !== "object"
      || (page.cursor !== undefined && (typeof page.cursor !== "string" || page.cursor.length > 16384))
      || (page.direction !== undefined && page.direction !== "older" && page.direction !== "newer"))) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "履歴の取得条件が不正です" } };
    }
    try {
      const conversation = await conversationHistory.readConversation((payload as { conversationId: string }).conversationId, page);
      if (!conversation) {
        return { ok: false, error: { code: "CONVERSATION_NOT_FOUND", message: "会話が見つかりません" } };
      }
      return { ok: true, conversation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: "CONVERSATION_READ_FAILED", message } };
    }
  });

  ipcMain.handle("conversations:create", async (_event, payload: unknown) => {
    const title = payload && typeof payload === "object" && typeof (payload as { title?: unknown }).title === "string"
      ? (payload as { title: string }).title
      : undefined;
    try {
      const conversation = await conversationHistory.createConversation(title);
      return { ok: true, conversation };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: "CONVERSATION_CREATE_FAILED", message } };
    }
  });

  ipcMain.handle("conversations:rename", async (_event, payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as { conversationId?: unknown }).conversationId !== "string" ||
      typeof (payload as { title?: unknown }).title !== "string"
    ) {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "conversationId と title は必須です" } };
    }
    try {
      await conversationHistory.renameConversation(
        (payload as { conversationId: string }).conversationId,
        (payload as { title: string }).title
      );
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: "CONVERSATION_RENAME_FAILED", message } };
    }
  });

  const removing = new Set<string>();
  const removed = new Set<string>();
  const removeConversation = async (kind: "archive" | "delete", payload: unknown) => {
    const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
    const conversationId = payload && typeof payload === "object" ? (payload as { conversationId?: unknown }).conversationId : undefined;
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      return fail("INVALID_REQUEST", "conversationId は必須です");
    }
    if (isHeartbeatAssistantSessionId(conversationId)) {
      return fail("CONVERSATION_UNSUPPORTED", "この会話はアーカイブ・削除できません");
    }
    if (removed.has(conversationId)) {
      return fail("CONVERSATION_UNAVAILABLE", "この会話は既に除去されています");
    }
    if (removing.has(conversationId)) {
      return fail("CONVERSATION_BUSY", "この会話は別の操作を処理中です");
    }
    if (preparingRuns.has(conversationId) || agentRuntime.isConversationRunning(conversationId)) {
      return fail("CONVERSATION_BUSY", "この会話は実行中です。処理の完了または中断後に再試行してください。");
    }
    removing.add(conversationId);
    try {
      let schedules: Awaited<ReturnType<SchedulerClient["listSchedules"]>>;
      try {
        schedules = await scheduler.listSchedules();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail("CONVERSATION_SCHEDULE_CHECK_FAILED", `スケジュールを確認できませんでした: ${message}`);
      }
      if (schedules.some((schedule) => schedule.sessionId === conversationId)) {
        return fail("CONVERSATION_HAS_SCHEDULES", "この会話に紐付くスケジュールがあります。設定の Schedules で削除してから再試行してください。");
      }
      // A run may have started while the schedule list was being fetched.
      if (preparingRuns.has(conversationId) || agentRuntime.isConversationRunning(conversationId)) {
        return fail("CONVERSATION_BUSY", "この会話は実行中です。処理の完了または中断後に再試行してください。");
      }
      try {
        if (kind === "archive") await conversationHistory.archiveConversation(conversationId);
        else await conversationHistory.deleteConversation(conversationId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(kind === "archive" ? "CONVERSATION_ARCHIVE_FAILED" : "CONVERSATION_DELETE_FAILED", message);
      }
      removed.add(conversationId);
      agentRuntime.forgetConversation(conversationId);
      return { ok: true as const };
    } finally {
      removing.delete(conversationId);
    }
  };

  ipcMain.handle("conversations:archive", (_event, payload: unknown) => removeConversation("archive", payload));
  ipcMain.handle("conversations:delete", (_event, payload: unknown) => removeConversation("delete", payload));
}
