import { contextBridge, ipcRenderer } from "electron";
import type { AgentLoopEvent } from "./shared/agent-loop";
import type { AudioTranscriptionResult } from "./shared/audio-transcription";
import type { HeartbeatAssistantStatus } from "./shared/heartbeat-assistant";
import type { SchedulerNotificationEvent, SchedulerScheduleSummary } from "./shared/scheduler";

const AGENT_LOOP_EVENT_CHANNEL = "agent:loopEvent";
const SCHEDULER_NOTIFICATION_CHANNEL = "scheduler:notification";

contextBridge.exposeInMainWorld("lilto", {
  submitPrompt: async (text: string, conversationId?: string | null, backendSessionId?: string | null) =>
    ipcRenderer.invoke("agent:submitPrompt", { text, conversationId, backendSessionId }),
  abortPrompt: async () => ipcRenderer.invoke("agent:abort"),
  openExternalUrl: async (url: string) => ipcRenderer.invoke("app:openExternal", { url }),
  startClaudeOauth: async () => ipcRenderer.invoke("auth:startClaudeOauth"),
  submitAuthCode: async (code: string) => ipcRenderer.invoke("auth:submitCode", { code }),
  getAuthState: async () => ipcRenderer.invoke("auth:getState"),
  listModels: async (payload: unknown) => ipcRenderer.invoke("models:list", payload),
  getProviderSettings: async () => ipcRenderer.invoke("providers:getSettings"),
  saveProviderSettings: async (settings: unknown) => ipcRenderer.invoke("providers:saveSettings", settings),
  getHeartbeatStatus: async (): Promise<HeartbeatAssistantStatus> => ipcRenderer.invoke("heartbeat:getStatus"),
  listSchedules: async (): Promise<
    | { ok: true; schedules: SchedulerScheduleSummary[] }
    | { ok: false; error: { code: string; message: string } }
  > => ipcRenderer.invoke("scheduler:list"),
  deleteSchedule: async (id: string): Promise<
    | { ok: true }
    | { ok: false; error: { code: string; message: string } }
  > => ipcRenderer.invoke("scheduler:delete", { id }),
  listPlugins: async (payload?: { forceRemoteSync?: boolean }) => ipcRenderer.invoke("plugins:list", payload ?? {}),
  readPlugin: async (payload: { marketplacePath: string; pluginName: string }) =>
    ipcRenderer.invoke("plugins:read", payload),
  installPlugin: async (payload: { marketplacePath: string; pluginName: string; sourceKind: "official-curated" | "bundled" }) =>
    ipcRenderer.invoke("plugins:install", payload),
  uninstallPlugin: async (payload: { pluginId: string; sourceKind?: "official-curated" | "bundled" }) =>
    ipcRenderer.invoke("plugins:uninstall", payload),
  setupWindowsSandbox: async (payload: unknown) => ipcRenderer.invoke("windowsSandbox:setup", payload),
  listSkills: async () => ipcRenderer.invoke("skills:list"),
  installSkill: async (url: string) => ipcRenderer.invoke("skills:install", { url }),
  installSkillFromSource: async (source: string) => ipcRenderer.invoke("skills:install", { source }),
  uninstallSkill: async (filePath: string) => ipcRenderer.invoke("skills:uninstall", { filePath }),
  checkSkillUpdates: async () => ipcRenderer.invoke("skills:checkUpdates"),
  transcribeAudio: async (audioData: Uint8Array): Promise<AudioTranscriptionResult> =>
    ipcRenderer.invoke("audio:transcribe", { audioData }),
  startNativeDictation: async () => ipcRenderer.invoke("audio:startNativeDictation"),
  finishNativeDictation: async (): Promise<AudioTranscriptionResult> => ipcRenderer.invoke("audio:finishNativeDictation"),
  cancelNativeDictation: async () => ipcRenderer.invoke("audio:cancelNativeDictation"),
  getPlatform: () => process.platform,
  onAgentLoopEvent: (listener: (event: AgentLoopEvent) => void) => {
    const wrapped = (_event: unknown, event: AgentLoopEvent) => listener(event);
    ipcRenderer.on(AGENT_LOOP_EVENT_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(AGENT_LOOP_EVENT_CHANNEL, wrapped);
  },
  onSchedulerNotification: (listener: (event: SchedulerNotificationEvent) => void) => {
    const wrapped = (_event: unknown, event: SchedulerNotificationEvent) => listener(event);
    ipcRenderer.on(SCHEDULER_NOTIFICATION_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(SCHEDULER_NOTIFICATION_CHANNEL, wrapped);
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
