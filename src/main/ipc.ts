import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "./agent-sdk";
import type { ClaudeAuthService } from "./auth-service";
import { AGENT_LOOP_EVENT_CHANNEL, validatePrompt } from "./ipc-contract";
import { createLogger } from "./logger";
import type { ProviderSettingsService } from "./provider-settings";
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
  providerSettingsService
}: {
  agentRuntime: AgentRuntime;
  authService: ClaudeAuthService;
  providerSettingsService: ProviderSettingsService;
}): void {
  const logger = createLogger("ipc");
  authService.subscribe(() => {
    broadcastAuthState(authService);
  });

  ipcMain.handle("agent:submitPrompt", async (_event, payload: unknown) => {
    const validation = validatePrompt(payload);
    if (!validation.ok) {
      logger.error("submit_prompt_invalid", validation);
      return { ok: false, error: validation };
    }

    const text = (payload as { text: string }).text;
    const requestId = randomUUID();
    broadcastLoopEvent({ type: "run_start", requestId });
    try {
      const providerSettings = providerSettingsService.getState();
      const result = await agentRuntime.submitPrompt(text, providerSettings, {
        requestId,
        onLoopEvent: (event) => {
          broadcastLoopEvent(event);
        }
      });
      if (!result.ok) {
        broadcastLoopEvent({
          type: "run_end",
          requestId,
          status: "failed",
          errorMessage: `${result.error.code}: ${result.error.message}`
        });
        return result;
      }

      broadcastLoopEvent({ type: "run_end", requestId, status: "completed" });

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

  ipcMain.handle("auth:getState", () => {
    return authService.getState();
  });

  ipcMain.handle("auth:startClaudeOauth", async () => {
    const state = await authService.startOAuth();
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

  ipcMain.handle("providers:saveSettings", (_event, payload: unknown) => {
    return providerSettingsService.save(payload);
  });
}
