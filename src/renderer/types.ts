import type { AgentLoopEvent } from "../shared/agent-loop.js";
import type { ActiveProvider, OAuthProviderId, ProviderSettings } from "../shared/provider-settings.js";
import type { SchedulerNotificationEvent } from "../shared/scheduler.js";

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
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
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
      getProviderSettings: () => Promise<ProviderSettings>;
      saveProviderSettings: (
        settings: ProviderSettings
      ) => Promise<
        | { ok: true; state: ProviderSettings }
        | { ok: false; error: { code: string; message: string } }
      >;
      listSkills: () => Promise<{ ok: true; skills: SkillInfo[] } | { ok: false; error: string }>;
      installSkill: (url: string) => Promise<{ ok: true; installedSkills: string[] } | { ok: false; error: string }>;
      installSkillFromSource: (source: string) => Promise<{ ok: true; output: string } | { ok: false; error: string }>;
      uninstallSkill: (filePath: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      checkSkillUpdates: () => Promise<SkillUpdateInfo[]>;
      getPlatform: () => string;
      onAgentLoopEvent: (listener: (event: AgentLoopEvent) => void) => () => void;
      onSchedulerNotification: (listener: (event: SchedulerNotificationEvent) => void) => () => void;
      onAuthStateChanged: (listener: (state: AuthState) => void) => () => void;
      onFocusComposer: (listener: () => void) => () => void;
    };
  }
}
