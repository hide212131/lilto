import { contextBridge, ipcRenderer } from "electron";
import type { AgentLoopEvent } from "./shared/agent-loop";

const AGENT_LOOP_EVENT_CHANNEL = "agent:loopEvent";

contextBridge.exposeInMainWorld("lilto", {
  submitPrompt: async (text: string) => ipcRenderer.invoke("agent:submitPrompt", { text }),
  abortPrompt: async () => ipcRenderer.invoke("agent:abort"),
  openExternalUrl: async (url: string) => ipcRenderer.invoke("app:openExternal", { url }),
  startClaudeOauth: async () => ipcRenderer.invoke("auth:startClaudeOauth"),
  submitAuthCode: async (code: string) => ipcRenderer.invoke("auth:submitCode", { code }),
  getAuthState: async () => ipcRenderer.invoke("auth:getState"),
  getProviderSettings: async () => ipcRenderer.invoke("providers:getSettings"),
  saveProviderSettings: async (settings: unknown) => ipcRenderer.invoke("providers:saveSettings", settings),
  listSkills: async () => ipcRenderer.invoke("skills:list"),
  installSkill: async (url: string) => ipcRenderer.invoke("skills:install", { url }),
  installSkillFromSource: async (source: string) => ipcRenderer.invoke("skills:install", { source }),
  uninstallSkill: async (filePath: string) => ipcRenderer.invoke("skills:uninstall", { filePath }),
  checkSkillUpdates: async () => ipcRenderer.invoke("skills:checkUpdates"),
  getPlatform: () => process.platform,
  onAgentLoopEvent: (listener: (event: AgentLoopEvent) => void) => {
    const wrapped = (_event: unknown, event: AgentLoopEvent) => listener(event);
    ipcRenderer.on(AGENT_LOOP_EVENT_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(AGENT_LOOP_EVENT_CHANNEL, wrapped);
  },
  onAuthStateChanged: (listener: (state: unknown) => void) => {
    const wrapped = (_event: unknown, state: unknown) => listener(state);
    ipcRenderer.on("auth:stateChanged", wrapped);
    return () => ipcRenderer.removeListener("auth:stateChanged", wrapped);
  },
  onFocusComposer: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("app:focusComposer", wrapped);
    return () => ipcRenderer.removeListener("app:focusComposer", wrapped);
  }
});
