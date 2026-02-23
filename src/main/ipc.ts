import { ipcMain } from "electron";
import type { PiAgentBridge } from "./agent-sdk";
import { validatePrompt } from "./ipc-contract";
import { createLogger } from "./logger";

export function registerAgentIpcHandlers({ agentBridge }: { agentBridge: PiAgentBridge }): void {
  const logger = createLogger("ipc");

  ipcMain.handle("agent:submitPrompt", async (_event, payload: unknown) => {
    const validation = validatePrompt(payload);
    if (!validation.ok) {
      logger.error("submit_prompt_invalid", validation);
      return { ok: false, error: validation };
    }

    const text = (payload as { text: string }).text;
    const result = await agentBridge.submitPrompt(text);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      request: { text },
      response: { text: result.text }
    };
  });
}
