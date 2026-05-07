import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "./agent-sdk";
import type { ClaudeAuthService } from "./auth-service";
import { AGENT_LOOP_EVENT_CHANNEL, validatePrompt } from "./ipc-contract";
import { createLogger } from "./logger";
import type { NotificationService } from "./notifications";
import type { HeartbeatAssistantService } from "./heartbeat-assistant";
import { isHeartbeatInternalScheduleId } from "./heartbeat-assistant";
import type { ProviderSettingsService } from "./provider-settings";
import type { ModelCatalogService } from "./model-catalog";
import type { SchedulerClient } from "./scheduler";
import type { SpeechTranscriptionService } from "./speech-transcription";
import type { WindowsSandboxSetupService } from "./windows-sandbox-setup";
import type { PluginService, PluginCatalogSourceKind } from "./plugin-service";
import { normalizePluginMentionsForPrompt } from "./plugin-mentions";
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

export function registerAgentIpcHandlers({
  agentRuntime,
  authService,
  providerSettingsService,
  bundledSkillsDir,
  userSkillsDir,
  workspaceDir,
  homeDir,
  codexHomeDir,
  notificationService,
  scheduler,
  heartbeatAssistant,
  pluginService,
  modelCatalogService,
  speechTranscriptionService,
  windowsSandboxSetupService,
  onSettingsSaved
}: {
  agentRuntime: AgentRuntime;
  authService: ClaudeAuthService & { setApiKey(apiKey: string | null): void };
  providerSettingsService: ProviderSettingsService;
  bundledSkillsDir: string;
  userSkillsDir: string;
  workspaceDir: string;
  homeDir: string;
  codexHomeDir: string;
  notificationService: NotificationService;
  scheduler: SchedulerClient;
  heartbeatAssistant: HeartbeatAssistantService;
  pluginService: PluginService;
  modelCatalogService: ModelCatalogService;
  speechTranscriptionService: SpeechTranscriptionService;
  windowsSandboxSetupService: WindowsSandboxSetupService;
  onSettingsSaved?: (settings: import("./provider-settings").ProviderSettings) => void;
}): void {
  const logger = createLogger("ipc");
  const agentsFilePath = path.join(workspaceDir, "AGENTS.md");
  authService.subscribe(() => {
    broadcastAuthState(authService);
  });

  const refreshAgentSkills = () => {
    const latestSkills = listSkillsWithSource({ bundledSkillsDir, userSkillsDir });
    agentRuntime.refreshSkills(latestSkills);
  };

  const refreshAgentPlugins = () => {
    agentRuntime.refreshPlugins();
  };

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
        return result;
      }

      if (!silent) {
        broadcastLoopEvent({ type: "run_end", requestId, status: "completed" });
      }

      // ウインドウが非フォーカス状態ならデスクトップ通知 + バッジを表示する
      if (!silent && BrowserWindow.getFocusedWindow() === null) {
        const preview = result.text.length > 80 ? `${result.text.slice(0, 77)}…` : result.text;
        notificationService.notify("lilto - 返答が届きました", preview);
        notificationService.incrementBadge();
      }

      return {
        ok: true,
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

  ipcMain.handle("heartbeat:getStatus", () => {
    return heartbeatAssistant.getStatus();
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
    if (!message) {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "message は空にできません" }
      };
    }

    if (BrowserWindow.getFocusedWindow() === null) {
      notificationService.notify("lilto - スケジュール通知", message);
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
      const result = await installSkillFromSource({ source: p.source, projectRoot: workspaceDir, userSkillsDir, homeDir, codexHomeDir });
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

  ipcMain.handle("plugins:list", async (_event, payload: unknown) => {
    const forceRemoteSync = Boolean(
      payload &&
      typeof payload === "object" &&
      typeof (payload as { forceRemoteSync?: unknown }).forceRemoteSync === "boolean" &&
      (payload as { forceRemoteSync: boolean }).forceRemoteSync
    );
    return await pluginService.listPlugins({ forceRemoteSync });
  });

  ipcMain.handle("plugins:read", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "payload が必須です" }
      };
    }

    const marketplacePath = typeof (payload as { marketplacePath?: unknown }).marketplacePath === "string"
      ? (payload as { marketplacePath: string }).marketplacePath
      : null;
    const pluginName = typeof (payload as { pluginName?: unknown }).pluginName === "string"
      ? (payload as { pluginName: string }).pluginName
      : null;

    if (!marketplacePath || !pluginName) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_REQUEST",
          message: "marketplacePath, pluginName は必須です"
        }
      };
    }

    return await pluginService.readPlugin({ marketplacePath, pluginName });
  });

  ipcMain.handle("plugins:install", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "payload が必須です" }
      };
    }

    const marketplacePath = typeof (payload as { marketplacePath?: unknown }).marketplacePath === "string"
      ? (payload as { marketplacePath: string }).marketplacePath
      : null;
    const pluginName = typeof (payload as { pluginName?: unknown }).pluginName === "string"
      ? (payload as { pluginName: string }).pluginName
      : null;
    const sourceKind = (payload as { sourceKind?: unknown }).sourceKind === "bundled"
      ? "bundled"
      : (payload as { sourceKind?: unknown }).sourceKind === "official-curated"
        ? "official-curated"
        : null;

    if (!marketplacePath || !pluginName || !sourceKind) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_REQUEST",
          message: "marketplacePath, pluginName, sourceKind は必須です"
        }
      };
    }

    const result = await pluginService.installPlugin({
      marketplacePath,
      pluginName,
      sourceKind: sourceKind as PluginCatalogSourceKind
    });
    if (result.ok) {
      refreshAgentPlugins();
    }
    return result;
  });

  ipcMain.handle("plugins:uninstall", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "payload が必須です" }
      };
    }

    const pluginId = typeof (payload as { pluginId?: unknown }).pluginId === "string"
      ? (payload as { pluginId: string }).pluginId
      : null;
    const sourceKind = (payload as { sourceKind?: unknown }).sourceKind === "bundled"
      ? "bundled"
      : (payload as { sourceKind?: unknown }).sourceKind === "official-curated"
        ? "official-curated"
        : undefined;

    if (!pluginId) {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "pluginId は必須です" }
      };
    }

    const result = await pluginService.uninstallPlugin({
      pluginId,
      sourceKind: sourceKind as PluginCatalogSourceKind | undefined
    });
    if (result.ok) {
      refreshAgentPlugins();
    }
    return result;
  });
}
