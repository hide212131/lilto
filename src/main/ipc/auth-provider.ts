import { ipcMain } from "electron";

import type { AgentRuntime } from "../agent-sdk";
import type { ClaudeAuthService } from "../auth-service";
import type { HeartbeatAssistantService } from "../heartbeat-assistant";
import type { ModelCatalogService } from "../model-catalog";
import type { ProviderSettings, ProviderSettingsService } from "../provider-settings";
import { broadcastAuthState } from "./utils";

export function registerAuthAndProviderIpcHandlers({
  agentRuntime,
  authService,
  providerSettingsService,
  heartbeatAssistant,
  modelCatalogService,
  onSettingsSaved
}: {
  agentRuntime: AgentRuntime;
  authService: ClaudeAuthService & { setApiKey(apiKey: string | null): void };
  providerSettingsService: ProviderSettingsService;
  heartbeatAssistant: HeartbeatAssistantService;
  modelCatalogService: ModelCatalogService;
  onSettingsSaved?: (settings: ProviderSettings) => void;
}): void {
  authService.subscribe(() => {
    broadcastAuthState(authService);
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
        ? (record.oauthProvider as import("../provider-settings").OAuthProviderId)
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
}