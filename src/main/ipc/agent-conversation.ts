import { randomUUID } from "node:crypto";

import { BrowserWindow, ipcMain } from "electron";

import type { AgentRuntime } from "../agent-sdk";
import { ConversationHistoryService } from "../conversation-history";
import { validatePrompt } from "../ipc-contract";
import { createLogger } from "../logger";
import type { NotificationService } from "../notifications";
import { normalizePluginMentionsForPrompt } from "../plugin-mentions";
import type { PluginService } from "../plugin-service";
import type { ProviderSettingsService } from "../provider-settings";
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
  conversationHistory
}: {
  agentRuntime: AgentRuntime;
  providerSettingsService: ProviderSettingsService;
  notificationService: NotificationService;
  pluginService: PluginService;
  conversationHistory: ConversationHistoryService;
}): void {
  const logger = createLogger("ipc");

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
    const text = await normalizePromptPluginMentions(originalText, pluginService);
    const requestId = randomUUID();
    if (!silent) {
      broadcastLoopEvent({ type: "run_start", requestId, conversationId });
    }
    try {
      const providerSettings = providerSettingsService.getState();
      const result = await agentRuntime.submitPrompt(text, providerSettings, {
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
    }
  });

  ipcMain.handle("agent:abort", () => {
    agentRuntime.abort();
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
    try {
      const conversation = await conversationHistory.readConversation((payload as { conversationId: string }).conversationId);
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

  ipcMain.handle("conversations:archive", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { conversationId?: unknown }).conversationId !== "string") {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "conversationId は必須です" } };
    }
    try {
      await conversationHistory.archiveConversation((payload as { conversationId: string }).conversationId);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: "CONVERSATION_ARCHIVE_FAILED", message } };
    }
  });
}
