import { BrowserWindow } from "electron";

import type { ClaudeAuthService } from "../auth-service";
import { AGENT_LOOP_EVENT_CHANNEL } from "../ipc-contract";
import type { AgentLoopEvent } from "../../shared/agent-loop";

export function broadcastAuthState(authService: Pick<ClaudeAuthService, "getState">): void {
  const state = authService.getState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("auth:stateChanged", state);
  }
}

export function broadcastLoopEvent(event: AgentLoopEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(AGENT_LOOP_EVENT_CHANNEL, event);
  }
}

export function openConversationWindow(conversationId: string): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    return;
  }

  for (const window of windows) {
    if (window.isMinimized()) {
      window.restore();
    } else if (!window.isVisible()) {
      window.show();
    }
    window.focus();
    window.webContents.send("app:openConversation", conversationId);
  }
}