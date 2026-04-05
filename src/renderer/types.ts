import type { AgentLoopEvent } from "../shared/agent-loop.js";
import type { AudioTranscriptionResult } from "../shared/audio-transcription.js";
import type { HeartbeatAssistantStatus } from "../shared/heartbeat-assistant.js";
import type { ActiveProvider, OAuthProviderId, ProviderSettings } from "../shared/provider-settings.js";
import type { SchedulerNotificationEvent, SchedulerScheduleSummary } from "../shared/scheduler.js";

export type SkillSource = "bundled" | "user";

export type SkillInfo = {
  name: string;
  description: string;
  parameters: unknown;
  filePath: string;
  source: SkillSource;
  installedVersion: string | null;
};

export type SkillUpdateInfo = {
  skillName: string;
  skillFilePath: string;
  sourceUrl: string;
  source: SkillSource;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

export type PluginCatalogSourceKind = "official-curated" | "bundled";

export type PluginCatalogInfo = {
  kind: PluginCatalogSourceKind;
  name: string;
  displayName: string;
  marketplacePath: string;
  pluginCount: number;
};

export type PluginInfo = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  marketplaceName: string;
  marketplacePath: string;
  sourceKind: PluginCatalogSourceKind;
  sourcePath: string | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";
  authPolicy: "ON_INSTALL" | "ON_USE";
  category: string | null;
  capabilities: string[];
  featured: boolean;
  installedVersion: string | null;
  installedAt: number | null;
  userInstalled: boolean;
};

export type PluginAppInfo = {
  id: string;
  name: string;
  description: string | null;
  installUrl: string | null;
  needsAuth: boolean;
};

export type PluginReadInfo = {
  plugin: PluginInfo;
  apps: PluginAppInfo[];
};

export type PluginMarketplaceLoadError = {
  marketplacePath: string;
  message: string;
};

export type PluginListState = {
  catalogs: PluginCatalogInfo[];
  marketplacePlugins: PluginInfo[];
  installedPlugins: PluginInfo[];
  marketplaceLoadErrors: PluginMarketplaceLoadError[];
  remoteSyncError: string | null;
};

export type AuthPhase =
  | "unauthenticated"
  | "auth_in_progress"
  | "awaiting_code"
  | "authenticated"
  | "auth_failed";

export type AuthState = {
  phase: AuthPhase;
  provider: OAuthProviderId;
  message: string;
  authUrl: string | null;
  updatedAt: number;
  debug: {
    codexAuthPath: string;
    codexAuthFileExists: boolean;
    authMode: string | null;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    hasOpenAiApiKey: boolean;
    hasStoredApiKey: boolean;
    isChatGptAuthenticated: boolean;
  lastCodexAuthReadError: string | null;
  };
};

export type ListedModel = {
  id: string;
  displayName: string;
};

export type { ActiveProvider, ProviderSettings };

export type AssistantToolProgress = {
  toolName: string;
  label?: string;
  detail?: string;
};

export type AssistantProgress = {
  statusLines: string[];
  thinkingText?: string;
  tools: AssistantToolProgress[];
  pendingLabel?: string;
};

export type Message = {
  id: string;
  requestId?: string;
  role: "user" | "assistant" | "system" | "error";
  text: string;
  pending?: boolean;
  progress?: AssistantProgress;
};

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  backendSessionId?: string;
  messages: Message[];
};

declare global {
  interface Window {
    lilto: {
      submitPrompt: (
        text: string,
        conversationId?: string | null
      ) => Promise<
        // 既存契約との互換性維持: submitPrompt の戻り値は変更しない。
        | { ok: true; response: { text: string } }
        | { ok: false; error?: { code?: string; message?: string; retryable?: boolean } }
      >;
      abortPrompt: () => Promise<{ ok: boolean }>;
      openExternalUrl: (
        url: string
      ) => Promise<
        | { ok: true }
        | { ok: false; error: { code: "INVALID_REQUEST" | "INVALID_URL" | "UNSUPPORTED_PROTOCOL"; message: string } }
      >;
      startClaudeOauth: () => Promise<{ ok: boolean; state: AuthState }>;
      submitAuthCode: (
        code: string
      ) => Promise<
        | { ok: true; state: AuthState }
        | { ok: false; error: { code: string; message: string } }
      >;
      getAuthState: () => Promise<AuthState>;
      listModels: (
        payload: unknown
      ) => Promise<
        | { ok: true; models: ListedModel[] }
        | { ok: false; error: { code: string; message: string } }
      >;
      getProviderSettings: () => Promise<ProviderSettings>;
      getHeartbeatStatus: () => Promise<HeartbeatAssistantStatus>;
      saveProviderSettings: (
        settings: ProviderSettings
      ) => Promise<
        | { ok: true; state: ProviderSettings }
        | { ok: false; error: { code: string; message: string } }
      >;
      listSchedules: () => Promise<
        | { ok: true; schedules: SchedulerScheduleSummary[] }
        | { ok: false; error: { code: string; message: string } }
      >;
      deleteSchedule: (id: string) => Promise<
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
      >;
      listPlugins: (payload?: { forceRemoteSync?: boolean }) => Promise<
        | { ok: true; state: PluginListState; message?: string }
        | { ok: false; error: { code: string; message: string }; state?: PluginListState }
      >;
      readPlugin: (payload: { marketplacePath: string; pluginName: string }) => Promise<
        | { ok: true; plugin: PluginInfo; apps: PluginAppInfo[] }
        | { ok: false; error: { code: string; message: string } }
      >;
      installPlugin: (payload: {
        marketplacePath: string;
        pluginName: string;
        sourceKind: PluginCatalogSourceKind;
      }) => Promise<
        | { ok: true; state: PluginListState; message?: string }
        | { ok: false; error: { code: string; message: string }; state?: PluginListState }
      >;
      uninstallPlugin: (payload: { pluginId: string; sourceKind?: PluginCatalogSourceKind }) => Promise<
        | { ok: true; state: PluginListState; message?: string }
        | { ok: false; error: { code: string; message: string }; state?: PluginListState }
      >;
      setupWindowsSandbox: (
        payload: { mode: "unelevated" | "elevated" }
      ) => Promise<
        | { ok: true; mode: "unelevated" | "elevated"; message: string }
        | { ok: false; error: { code: string; message: string; retryable: boolean } }
      >;
      listSkills: () => Promise<{ ok: true; skills: SkillInfo[] } | { ok: false; error: string }>;
      installSkill: (url: string) => Promise<{ ok: true; installedSkills: string[] } | { ok: false; error: string }>;
      installSkillFromSource: (source: string) => Promise<{ ok: true; output: string } | { ok: false; error: string }>;
      uninstallSkill: (filePath: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      checkSkillUpdates: () => Promise<SkillUpdateInfo[]>;
      transcribeAudio: (audioData: Uint8Array) => Promise<AudioTranscriptionResult>;
      startNativeDictation: () => Promise<
        | { ok: true }
        | { ok: false; error: { code: string; message: string; retryable: boolean } }
      >;
      finishNativeDictation: () => Promise<AudioTranscriptionResult>;
      cancelNativeDictation: () => Promise<{ ok: true }>;
      getPlatform: () => string;
      onAgentLoopEvent: (listener: (event: AgentLoopEvent) => void) => () => void;
      onSchedulerNotification: (listener: (event: SchedulerNotificationEvent) => void) => () => void;
      onAuthStateChanged: (listener: (state: AuthState) => void) => () => void;
      onFocusComposer: (listener: () => void) => () => void;
    };
  }
}
