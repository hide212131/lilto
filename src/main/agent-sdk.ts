import { createLogger, type Logger } from "./logger";

type AgentError = {
  code: string;
  message: string;
  details: string | null;
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

export function standardizeError(error: unknown, code = "AGENT_EXECUTION_FAILED"): AgentError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
      details: error.stack ?? null
    };
  }

  return {
    code,
    message: String(error),
    details: null
  };
}

export async function createPiSessionFromSdk(): Promise<PiSession> {
  const { AuthStorage, createAgentSession, ModelRegistry, SessionManager } = await import(
    "@mariozechner/pi-coding-agent"
  );

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    cwd: process.cwd()
  });

  return session as PiSession;
}

export class PiAgentBridge {
  private readonly createSession: () => Promise<PiSession>;
  private readonly logger: Logger;
  private session: PiSession | null = null;

  constructor({
    createSession = createPiSessionFromSdk,
    logger = createLogger("agent")
  }: {
    createSession?: () => Promise<PiSession>;
    logger?: Logger;
  } = {}) {
    this.createSession = createSession;
    this.logger = logger;
  }

  private async ensureSession(): Promise<PiSession> {
    if (this.session) return this.session;
    this.session = await this.createSession();
    return this.session;
  }

  async submitPrompt(text: string): Promise<AgentResult> {
    this.logger.info("agent_prompt_received", { textLength: text.length });
    try {
      const session = await this.ensureSession();
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
