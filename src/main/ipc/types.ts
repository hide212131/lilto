import type { AgentRuntime } from "../agent-sdk";
import type { ClaudeAuthService } from "../auth-service";
import type { HeartbeatAssistantService } from "../heartbeat-assistant";
import type { ModelCatalogService } from "../model-catalog";
import type { NotificationService } from "../notifications";
import type { PluginService } from "../plugin-service";
import type { ProviderSettings, ProviderSettingsService } from "../provider-settings";
import type { SchedulerClient } from "../scheduler";
import type { SpeechTranscriptionService } from "../speech-transcription";
import type { WindowsSandboxSetupService } from "../windows-sandbox-setup";

export type RegisterAgentIpcHandlersOptions = {
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
  onSettingsSaved?: (settings: ProviderSettings) => void;
};