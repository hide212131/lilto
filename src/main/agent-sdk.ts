import { createLogger, type Logger } from "./logger";
import type { ClaudeAuthService } from "./auth-service";
import type { ProviderSettings } from "./provider-settings";
import { isCustomProviderReady } from "./provider-settings";
import { shouldPrioritizeAgentBrowser } from "./skill-runtime";
import type { AgentLoopEvent } from "../shared/agent-loop";

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
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    content?: string;
    message?: {
      content?: Array<{ type?: string; text?: string; thinking?: string }>;
    };
  };
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string; thinking?: string }> | string;
  };
};

type PiSession = {
  prompt: (text: string) => Promise<void>;
  subscribe: (listener: (event: AgentEvent) => void) => () => void;
};

type PiModel = {
  id: string;
  name: string;
  api: "openai-completions";
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: ["text"];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
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

export async function createPiSessionFromSdk(options: {
  apiKey: string | null;
  model?: PiModel;
  cwd?: string;
}): Promise<PiSession> {
  const sessionCwd = options.cwd ?? process.cwd();
  const { AuthStorage, createAgentSession, ModelRegistry, SessionManager } = (await importEsm(
    "@mariozechner/pi-coding-agent"
  )) as {
    AuthStorage: { create: () => unknown };
    createAgentSession: (args: {
      sessionManager: unknown;
      authStorage: unknown;
      modelRegistry: unknown;
      cwd: string;
      model?: PiModel;
    }) => Promise<{ session: unknown }>;
    ModelRegistry: new (authStorage: unknown) => unknown;
    SessionManager: {
      inMemory: (cwd?: string) => unknown;
      create?: (cwd: string) => unknown;
    };
  };

  const authStorage = AuthStorage.create();
  const authStorageWithRuntimeKey = authStorage as { setRuntimeApiKey?: (provider: string, key: string) => void };
  if (options.apiKey && typeof authStorageWithRuntimeKey.setRuntimeApiKey === "function") {
    const keyProvider = options.model?.provider ?? "anthropic";
    authStorageWithRuntimeKey.setRuntimeApiKey(keyProvider, options.apiKey);
  }
  const modelRegistry = new ModelRegistry(authStorage);

  const sessionManager =
    typeof SessionManager.create === "function" ? SessionManager.create(sessionCwd) : SessionManager.inMemory(sessionCwd);

  const { session } = await createAgentSession({
    sessionManager,
    authStorage,
    modelRegistry,
    cwd: sessionCwd,
    model: options.model
  });

  return session as PiSession;
}

type AuthSnapshot = {
  phase: "unauthenticated" | "auth_in_progress" | "awaiting_code" | "authenticated" | "auth_failed";
};

function buildCustomModel(settings: ProviderSettings): PiModel {
  const modelId = settings.customProvider.modelId.trim() || "gpt-4.1-mini";
  const providerName = settings.customProvider.name.trim() || "custom-provider";
  const baseUrlInput = settings.customProvider.baseUrl.trim();
  const baseUrl = normalizeBaseUrl(baseUrlInput);

  return {
    id: modelId,
    name: providerName,
    api: "openai-completions",
    provider: "custom-openai-completions",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 128000,
    maxTokens: 16384
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const isOllamaHost = (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "11434";
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (isOllamaHost && (normalizedPath === "" || normalizedPath === "/")) {
      parsed.pathname = "/v1";
      return parsed.toString().replace(/\/$/, "");
    }
    return baseUrl;
  } catch {
    return baseUrl;
  }
}

function extractTextFromContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as { type?: string; text?: string; thinking?: string };
    if (block.type === "text" && typeof block.text === "string") {
      chunks.push(block.text);
      continue;
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      chunks.push(block.thinking);
    }
  }
  return chunks.join("");
}

function extractTextFromAgentEvent(event: AgentEvent): string {
  if (event.type === "message_update" && event.assistantMessageEvent) {
    const stream = event.assistantMessageEvent;
    if (stream.type === "text_delta" && typeof stream.delta === "string") {
      return stream.delta;
    }
    if (stream.type === "text_end" && typeof stream.content === "string") {
      return stream.content;
    }
    if (stream.type === "done") {
      return extractTextFromContent(stream.message?.content);
    }
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    return extractTextFromContent(event.message.content);
  }

  return "";
}

function isLocalOllamaUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "11434";
  } catch {
    return false;
  }
}

export class AgentRuntime {
  private readonly createSession: (options: { apiKey: string | null; model?: PiModel; cwd?: string }) => Promise<PiSession>;
  private readonly authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
  private readonly logger: Logger;
  private readonly workspaceDir?: string;
  private readonly availableSkillNames: Set<string>;
  private session: PiSession | null = null;
  private sessionKey: string | null = null;

  constructor({
    createSession = createPiSessionFromSdk,
    authService,
    workspaceDir,
    availableSkills = [],
    logger = createLogger("agent")
  }: {
    createSession?: (options: { apiKey: string | null; model?: PiModel; cwd?: string }) => Promise<PiSession>;
    authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
    workspaceDir?: string;
    availableSkills?: Array<{ name: string }>;
    logger?: Logger;
  }) {
    this.createSession = createSession;
    this.authService = authService;
    this.logger = logger;
    this.workspaceDir = workspaceDir;
    this.availableSkillNames = new Set(availableSkills.map((skill) => skill.name));
  }

  private async ensureSession(options: { apiKey: string | null; model?: PiModel; cwd?: string }): Promise<PiSession> {
    const signature = JSON.stringify({
      apiKey: options.apiKey,
      provider: options.model?.provider ?? "anthropic",
      model: options.model?.id ?? "default",
      baseUrl: options.model?.baseUrl ?? "",
      cwd: options.cwd ?? process.cwd()
    });

    if (this.session && this.sessionKey === signature) {
      return this.session;
    }

    this.session = await this.createSession(options);
    this.sessionKey = signature;
    return this.session;
  }

  private async runSessionPrompt(
    text: string,
    options: { apiKey: string | null; model?: PiModel; cwd?: string },
    hooks?: { requestId: string; onLoopEvent?: (event: AgentLoopEvent) => void }
  ): Promise<AgentResult> {
    const session = await this.ensureSession(options);
    let streamOutput = "";
    let finalOutput = "";

    const unsubscribe = session.subscribe((event) => {
      if (hooks?.onLoopEvent) {
        if (event.type === "thinking_start") {
          hooks.onLoopEvent({ type: "thinking_start", requestId: hooks.requestId });
        } else if (event.type === "thinking_end") {
          hooks.onLoopEvent({ type: "thinking_end", requestId: hooks.requestId });
        } else if (
          event.type === "tool_execution_start" &&
          typeof event.toolCallId === "string" &&
          typeof event.toolName === "string"
        ) {
          const startEvent: AgentLoopEvent = {
            type: "tool_execution_start",
            requestId: hooks.requestId,
            toolCallId: event.toolCallId,
            toolName: event.toolName
          };
          if (event.args !== undefined) {
            startEvent.args = event.args;
          }
          hooks.onLoopEvent(startEvent);
        } else if (
          event.type === "tool_execution_end" &&
          typeof event.toolCallId === "string" &&
          typeof event.toolName === "string"
        ) {
          hooks.onLoopEvent({
            type: "tool_execution_end",
            requestId: hooks.requestId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: event.isError === true
          });
        }
      }

      if (event.type === "message_update") {
        if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
          streamOutput += event.assistantMessageEvent.delta;
          return;
        }
        if (event.assistantMessageEvent?.type === "done") {
          finalOutput = extractTextFromAgentEvent(event);
          return;
        }
        if (event.assistantMessageEvent?.type === "text_end" && !streamOutput) {
          finalOutput = extractTextFromAgentEvent(event);
          return;
        }
      }

      if (event.type === "message_end") {
        const textFromEnd = extractTextFromAgentEvent(event);
        if (textFromEnd) {
          finalOutput = textFromEnd;
        }
      }
    });

    try {
      await session.prompt(text);
    } finally {
      unsubscribe();
    }

    let output = finalOutput.trim() ? finalOutput : streamOutput;
    if (!output.trim()) {
      output = "エージェント応答は空でした。";
    }

    this.logger.info("agent_prompt_completed", { outputLength: output.length });
    return { ok: true, text: output };
  }

  private buildPromptWithSkillHint(text: string): string {
    if (!this.availableSkillNames.has("agent-browser")) {
      return text;
    }
    if (!shouldPrioritizeAgentBrowser(text)) {
      return text;
    }
    if (text.trimStart().startsWith("/skill:")) {
      return text;
    }
    return `/skill:agent-browser\n\n${text}`;
  }

  async submitPrompt(
    text: string,
    providerSettings: ProviderSettings,
    hooks?: { requestId: string; onLoopEvent?: (event: AgentLoopEvent) => void }
  ): Promise<AgentResult> {
    this.logger.info("agent_prompt_received", {
      textLength: text.length,
      provider: providerSettings.activeProvider
    });

    try {
      if (process.env.LILTO_E2E_MOCK === "1") {
        const mock = `[E2E_MOCK] ${text}`;
        this.logger.info("agent_prompt_mock_completed", { outputLength: mock.length });
        return { ok: true, text: mock };
      }

      const promptText = this.buildPromptWithSkillHint(text);
      const runOptionsBase = { cwd: this.workspaceDir };

      if (providerSettings.activeProvider === "custom-openai-completions") {
        if (!isCustomProviderReady(providerSettings)) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_CONFIG_REQUIRED",
              message: "Custom Provider を使うには name と baseUrl の設定が必要です。",
              details: null,
              retryable: true
            }
          };
        }

        const model = buildCustomModel(providerSettings);
        const apiKeyFromSettings = providerSettings.customProvider.apiKey;
        const apiKey =
          apiKeyFromSettings && apiKeyFromSettings.trim()
            ? apiKeyFromSettings
            : isLocalOllamaUrl(model.baseUrl)
              ? "ollama"
              : "not-required";
        return await this.runSessionPrompt(promptText, { apiKey, model, ...runOptionsBase }, hooks);
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

      return await this.runSessionPrompt(promptText, { apiKey, model: undefined, ...runOptionsBase }, hooks);
    } catch (error) {
      const normalized = standardizeError(error);
      this.logger.error("agent_prompt_failed", normalized);
      return { ok: false, error: normalized };
    }
  }
}

// Backward-compatible alias for existing imports.
export { AgentRuntime as PiAgentBridge };
