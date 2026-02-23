import { BrowserWindow, ipcMain } from "electron";
import type { AgentRuntime } from "./agent-sdk";
import type { ClaudeAuthService } from "./auth-service";
import { validatePrompt } from "./ipc-contract";
import { createLogger } from "./logger";

function broadcastAuthState(authService: Pick<ClaudeAuthService, "getState">): void {
  const state = authService.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("auth:stateChanged", state);
  }
}

export function registerAgentIpcHandlers({
  agentRuntime,
  authService
}: {
  agentRuntime: AgentRuntime;
  authService: ClaudeAuthService;
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
    const result = await agentRuntime.submitPrompt(text);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      request: { text },
      response: { text: result.text }
    };
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
}
