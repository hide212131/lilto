import type { AgentLoopEvent } from "../shared/agent-loop.js";

export type AuthPhase =
  | "unauthenticated"
  | "auth_in_progress"
  | "awaiting_code"
  | "authenticated"
  | "auth_failed";

export type AuthState = {
  phase: AuthPhase;
  provider: "anthropic";
  message: string;
  authUrl: string | null;
  updatedAt: number;
};

export type ActiveProvider = "claude" | "custom-openai-completions";

export type ProviderSettings = {
  activeProvider: ActiveProvider;
  customProvider: {
    name: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
  };
  updatedAt: number;
};

export type Message = {
  role: "user" | "assistant" | "system" | "error";
  text: string;
  pending?: boolean;
};

declare global {
  interface Window {
    lilto: {
      submitPrompt: (
        text: string
      ) => Promise<
        // 既存契約との互換性維持: submitPrompt の戻り値は変更しない。
        | { ok: true; response: { text: string } }
        | { ok: false; error?: { code?: string; message?: string; retryable?: boolean } }
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
      onAgentLoopEvent: (listener: (event: AgentLoopEvent) => void) => () => void;
      onAuthStateChanged: (listener: (state: AuthState) => void) => () => void;
    };
  }
}
