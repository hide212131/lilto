import { BrowserWindow, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "./agent-sdk";
import type { ClaudeAuthService } from "./auth-service";
import { AGENT_LOOP_EVENT_CHANNEL, validatePrompt } from "./ipc-contract";
import { createLogger } from "./logger";
import type { NotificationService } from "./notifications";
import type { ProviderSettingsService } from "./provider-settings";
import type { ModelCatalogService } from "./model-catalog";
import type { WindowsSandboxSetupService } from "./windows-sandbox-setup";
import { checkSkillUpdates, installSkillFromSource, installSkillFromUrl, listSkillsWithSource, uninstallUserSkill } from "./skill-runtime";
import type { AgentLoopEvent } from "../shared/agent-loop";

function broadcastAuthState(authService: Pick<ClaudeAuthService, "getState">): void {
  const state = authService.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("auth:stateChanged", state);
  }
}

function broadcastLoopEvent(event: AgentLoopEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(AGENT_LOOP_EVENT_CHANNEL, event);
  }
}

export function registerAgentIpcHandlers({
  agentRuntime,
  authService,
  providerSettingsService,
  bundledSkillsDir,
  userSkillsDir,
  homeDir,
  codexHomeDir,
  notificationService,
  modelCatalogService,
  windowsSandboxSetupService,
  onSettingsSaved
}: {
  agentRuntime: AgentRuntime;
  authService: ClaudeAuthService & { setApiKey(apiKey: string | null): void };
  providerSettingsService: ProviderSettingsService;
  bundledSkillsDir: string;
  userSkillsDir: string;
  homeDir: string;
  codexHomeDir: string;
  notificationService: NotificationService;
  modelCatalogService: ModelCatalogService;
  windowsSandboxSetupService: WindowsSandboxSetupService;
  onSettingsSaved?: (settings: import("./provider-settings").ProviderSettings) => void;
}): void {
  const logger = createLogger("ipc");
  authService.subscribe(() => {
    broadcastAuthState(authService);
  });

  const refreshAgentSkills = () => {
    const latestSkills = listSkillsWithSource({ bundledSkillsDir, userSkillsDir });
    agentRuntime.refreshSkills(latestSkills);
  };

  ipcMain.handle("agent:submitPrompt", async (_event, payload: unknown) => {
    const validation = validatePrompt(payload);
    if (!validation.ok) {
      logger.error("submit_prompt_invalid", validation);
      return { ok: false, error: validation };
    }

    const text = (payload as { text: string }).text;
    const conversationId =
      typeof (payload as { conversationId?: unknown }).conversationId === "string"
        ? (payload as { conversationId: string }).conversationId
        : undefined;
    const requestId = randomUUID();
    broadcastLoopEvent({ type: "run_start", requestId });
    try {
      const providerSettings = providerSettingsService.getState();
      const result = await agentRuntime.submitPrompt(text, providerSettings, {
        requestId,
        conversationId,
        onLoopEvent: (event) => {
          broadcastLoopEvent(event);
        }
      });
      if (!result.ok) {
        broadcastLoopEvent({
          type: "run_end",
          requestId,
          status: result.error.code === "ABORTED" ? "aborted" : "failed",
          errorMessage: `${result.error.code}: ${result.error.message}`
        });
        return result;
      }

      broadcastLoopEvent({ type: "run_end", requestId, status: "completed" });

      // ウインドウが非フォーカス状態ならデスクトップ通知 + バッジを表示する
      if (BrowserWindow.getFocusedWindow() === null) {
        const preview = result.text.length > 80 ? `${result.text.slice(0, 77)}…` : result.text;
        notificationService.notify("lilto - 返答が届きました", preview);
        notificationService.incrementBadge();
      }

      return {
        ok: true,
        request: { text },
        response: { text: result.text }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcastLoopEvent({ type: "run_end", requestId, status: "failed", errorMessage: message });
      throw error;
    }
  });

  ipcMain.handle("agent:abort", () => {
    agentRuntime.abort();
    return { ok: true };
  });

  ipcMain.handle("auth:getState", () => {
    return authService.getState();
  });

  ipcMain.handle("auth:startClaudeOauth", async () => {
    const state = await authService.startOAuth("openai-codex");
    return { ok: state.phase === "authenticated", state };
  });

  ipcMain.handle("auth:submitCode", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { code?: unknown }).code !== "string") {
      return { ok: false, error: { code: "INVALID_REQUEST", message: "code は必須です" } };
    }

    try {
      const state = authService.submitAuthorizationCode((payload as { code: string }).code);
      return { ok: true, state };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: "AUTH_CODE_REJECTED", message } };
    }
  });

  ipcMain.handle("providers:getSettings", () => {
    return providerSettingsService.getState();
  });

  ipcMain.handle("models:list", async (_event, payload: unknown) => {
    const state = providerSettingsService.getState();
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const mode = record.mode === "custom-openai-completions" ? "custom-openai-completions" : "oauth";
    const networkProxy =
      record.networkProxy && typeof record.networkProxy === "object" && typeof (record.networkProxy as { useProxy?: unknown }).useProxy === "boolean"
        ? { useProxy: (record.networkProxy as { useProxy: boolean }).useProxy }
        : state.networkProxy;

    if (mode === "custom-openai-completions") {
      const customProvider =
        record.customProvider && typeof record.customProvider === "object"
          ? {
              baseUrl: typeof (record.customProvider as { baseUrl?: unknown }).baseUrl === "string"
                ? (record.customProvider as { baseUrl: string }).baseUrl
                : state.customProvider.baseUrl,
              apiKey: typeof (record.customProvider as { apiKey?: unknown }).apiKey === "string"
                ? (record.customProvider as { apiKey: string }).apiKey
                : state.customProvider.apiKey
            }
          : {
              baseUrl: state.customProvider.baseUrl,
              apiKey: state.customProvider.apiKey
            };
      return await modelCatalogService.listCustomProviderModels(customProvider, networkProxy);
    }

    const oauthProvider =
      typeof record.oauthProvider === "string"
        ? (record.oauthProvider as import("./provider-settings").OAuthProviderId)
        : state.oauthProvider;
    return await modelCatalogService.listOauthModels(oauthProvider, networkProxy);
  });

  ipcMain.handle("providers:saveSettings", (_event, payload: unknown) => {
    const result = providerSettingsService.save(payload);
    if (result.ok) {
      authService.setApiKey(result.state.customProvider.apiKey || null);
      agentRuntime.refreshProviderSettings();
      if (onSettingsSaved) {
        onSettingsSaved(result.state);
      }
    }
    return result;
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

  ipcMain.handle("skills:list", () => {
    try {
      return {
        ok: true as const,
        skills: listSkillsWithSource({ bundledSkillsDir, userSkillsDir })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle("skills:install", async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown> | null;
    if (!p) return { ok: false, error: "payload が必須です" };

    if (typeof p.source === "string") {
      const result = await installSkillFromSource({ source: p.source, userSkillsDir, homeDir, codexHomeDir });
      if (result.ok) {
        refreshAgentSkills();
      }
      return result;
    }

    if (typeof p.url === "string") {
      const result = await installSkillFromUrl({ url: p.url, userSkillsDir });
      if (result.ok) {
        refreshAgentSkills();
      }
      return result;
    }

    return { ok: false, error: "source または url は必須です" };
  });

  ipcMain.handle("skills:uninstall", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { filePath?: unknown }).filePath !== "string") {
      return { ok: false, error: "filePath は必須です" };
    }
    const result = uninstallUserSkill({ skillFilePath: (payload as { filePath: string }).filePath, userSkillsDir });
    if (result.ok) {
      refreshAgentSkills();
    }
    return result;
  });

  ipcMain.handle("skills:checkUpdates", async () => {
    return checkSkillUpdates({ userSkillsDir, bundledSkillsDir });
  });
}
