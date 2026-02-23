import { createLogger, type Logger } from "./logger";
import type { ClaudeAuthService } from "./auth-service";

type AgentError = {
  code: string;
  message: string;
  details: string | null;
  retryable: boolean;
};

type AgentSuccess = { ok: true; text: string };
type AgentFailure = { ok: false; error: AgentError };
export type AgentResult = AgentSuccess | AgentFailure;

type AgentEvent = {
  type: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
};

type PiSession = {
  prompt: (text: string) => Promise<void>;
  subscribe: (listener: (event: AgentEvent) => void) => () => void;
};

const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

export function standardizeError(
  error: unknown,
  code = "AGENT_EXECUTION_FAILED",
  retryable = true
): AgentError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
      details: error.stack ?? null,
      retryable
    };
  }

  return {
    code,
    message: String(error),
    details: null,
    retryable
  };
}

export async function createPiSessionFromSdk(apiKey: string | null): Promise<PiSession> {
  const { AuthStorage, createAgentSession, ModelRegistry, SessionManager } = (await importEsm(
    "@mariozechner/pi-coding-agent"
  )) as {
    AuthStorage: { create: () => unknown };
    createAgentSession: (args: {
      sessionManager: unknown;
      authStorage: unknown;
      modelRegistry: unknown;
      cwd: string;
    }) => Promise<{ session: unknown }>;
    ModelRegistry: new (authStorage: unknown) => unknown;
    SessionManager: { inMemory: () => unknown };
  };

  const authStorage = AuthStorage.create();
  const authStorageWithRuntimeKey = authStorage as { setRuntimeApiKey?: (provider: string, key: string) => void };
  if (apiKey && typeof authStorageWithRuntimeKey.setRuntimeApiKey === "function") {
    authStorageWithRuntimeKey.setRuntimeApiKey("anthropic", apiKey);
  }
  const modelRegistry = new ModelRegistry(authStorage);

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    cwd: process.cwd()
  });

  return session as PiSession;
}

type AuthSnapshot = {
  phase: "unauthenticated" | "auth_in_progress" | "awaiting_code" | "authenticated" | "auth_failed";
};

export class AgentRuntime {
  private readonly createSession: (apiKey: string | null) => Promise<PiSession>;
  private readonly authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
  private readonly logger: Logger;
  private session: PiSession | null = null;
  private sessionApiKey: string | null = null;

  constructor({
    createSession = createPiSessionFromSdk,
    authService,
    logger = createLogger("agent")
  }: {
    createSession?: (apiKey: string | null) => Promise<PiSession>;
    authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
    logger?: Logger;
  }) {
    this.createSession = createSession;
    this.authService = authService;
    this.logger = logger;
  }

  private async ensureSession(apiKey: string | null): Promise<PiSession> {
    if (this.session && this.sessionApiKey === apiKey) return this.session;
    this.session = await this.createSession(apiKey);
    this.sessionApiKey = apiKey;
    return this.session;
  }

  async submitPrompt(text: string): Promise<AgentResult> {
    this.logger.info("agent_prompt_received", { textLength: text.length });
    try {
      if (process.env.LILTO_E2E_MOCK === "1") {
        const mock = `[E2E_MOCK] ${text}`;
        this.logger.info("agent_prompt_mock_completed", { outputLength: mock.length });
        return { ok: true, text: mock };
      }

      const authState = this.authService.getState() as AuthSnapshot;
      if (authState.phase !== "authenticated") {
        return {
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "Claude を利用するには OAuth 認証が必要です。",
            details: null,
            retryable: true
          }
        };
      }

      const apiKey = await this.authService.getApiKey();
      if (!apiKey) {
        return {
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "認証情報を取得できませんでした。再認証してください。",
            details: null,
            retryable: true
          }
        };
      }

      const session = await this.ensureSession(apiKey);
      let output = "";

      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          output += event.assistantMessageEvent.delta ?? "";
        }
      });

      await session.prompt(text);
      unsubscribe();

      if (!output.trim()) {
        output = "エージェント応答は空でした。";
      }

      this.logger.info("agent_prompt_completed", { outputLength: output.length });
      return { ok: true, text: output };
    } catch (error) {
      const normalized = standardizeError(error);
      this.logger.error("agent_prompt_failed", normalized);
      return { ok: false, error: normalized };
    }
  }
}

// Backward-compatible alias for existing imports.
export { AgentRuntime as PiAgentBridge };
