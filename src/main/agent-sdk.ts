import http from "node:http";
import { createLogger, type Logger } from "./logger";
import type { ClaudeAuthService } from "./auth-service";
import type { ProviderSettings } from "./provider-settings";
import { isCustomProviderReady } from "./provider-settings";
import { shouldPrioritizeAgentBrowser, shouldPrioritizeSkillCreator } from "./skill-runtime";
import { createCliCompatibilityMap, isWindowsExecutionPolicyError } from "./command-compat";
import type { AgentLoopEvent } from "../shared/agent-loop";
import type { OAuthProviderId } from "../shared/provider-settings";

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
  delta?: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    thinking?: string;
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

function standardizeAgentRuntimeError(error: unknown): AgentError {
  if (isWindowsExecutionPolicyError(error)) {
    const map = createCliCompatibilityMap("win32");
    return {
      code: "WINDOWS_CLI_EXECUTION_BLOCKED",
      message: "Windows 実行ポリシーの制約で CLI 起動に失敗しました。",
      details: `Windows では .cmd シムを優先してください: ${map.npm}, ${map.npx}, ${map.openspec}`,
      retryable: true
    };
  }
  return standardizeError(error);
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
  provider: OAuthProviderId;
};

type ConversationTurn = {
  userText: string;
  assistantText: string;
  completedAt: number;
};

type HeartbeatSkillProposal = {
  skillName: string;
  description: string;
  summary: string;
  fingerprint: string;
  createdAt: number;
};

const HEARTBEAT_PROPOSAL_DELAY_MS = 60 * 1000;
const MAX_CONVERSATION_HISTORY = 24;

function normalizeSimilarityText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "");
}

function createStableHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function truncateSummary(text: string, max = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function getHeartbeatProposalDelayMs(): number {
  const raw = process.env.LILTO_HEARTBEAT_PROPOSAL_DELAY_MS;
  if (!raw) return HEARTBEAT_PROPOSAL_DELAY_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return HEARTBEAT_PROPOSAL_DELAY_MS;
  return parsed;
}

function indicatesSessionCompletion(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes("thanks") ||
    lowered.includes("thank you") ||
    lowered.includes("solved") ||
    lowered.includes("done") ||
    text.includes("ありがとう") ||
    text.includes("助かった") ||
    text.includes("解決") ||
    text.includes("完了")
  );
}

function isApprovalText(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  return (
    lowered === "y" ||
    lowered === "yes" ||
    lowered === "ok" ||
    lowered === "okay" ||
    lowered === "approve" ||
    lowered.startsWith("はい") ||
    lowered.startsWith("承認") ||
    lowered.startsWith("許可") ||
    lowered.startsWith("お願いします")
  );
}

function isRejectText(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  return (
    lowered === "n" ||
    lowered === "no" ||
    lowered.startsWith("いいえ") ||
    lowered.startsWith("不要") ||
    lowered.startsWith("キャンセル") ||
    lowered.startsWith("skip")
  );
}

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

function normalizeNoProxyEntries(noProxyValue: string): string[] {
  return noProxyValue
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getProxyValue(upper: string, lower: string): string {
  return process.env[upper]?.trim() || process.env[lower]?.trim() || "";
}

function getProxyEnvironmentValues(): { httpProxy: string; httpsProxy: string; noProxy: string } {
  return {
    httpProxy: getProxyValue("HTTP_PROXY", "http_proxy"),
    httpsProxy: getProxyValue("HTTPS_PROXY", "https_proxy"),
    noProxy: getProxyValue("NO_PROXY", "no_proxy")
  };
}

function shouldBypassProxyForHost(hostname: string, noProxyValue: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  if (!normalizedHost) return false;
  const entries = normalizeNoProxyEntries(noProxyValue);
  return entries.some((entry) => {
    if (entry === "*") return true;
    if (entry.startsWith(".")) {
      return normalizedHost.endsWith(entry);
    }
    return normalizedHost === entry;
  });
}

function resolveProxyForTarget(
  targetUrl: URL,
  proxyEnv: { httpProxy: string; httpsProxy: string; noProxy: string }
): string {
  if (shouldBypassProxyForHost(targetUrl.hostname, proxyEnv.noProxy)) {
    return "";
  }
  if (targetUrl.protocol === "https:") {
    return proxyEnv.httpsProxy || proxyEnv.httpProxy;
  }
  if (targetUrl.protocol === "http:") {
    return proxyEnv.httpProxy;
  }
  return "";
}

async function runProxyPrecheckIfEnabled(settings: ProviderSettings): Promise<void> {
  const probeUrl = process.env.LILTO_PROXY_TEST_URL?.trim();
  if (!probeUrl) return;

  const targetUrl = new URL(probeUrl);
  if (targetUrl.protocol !== "http:") {
    throw new Error("LILTO_PROXY_TEST_URL は http URL のみサポートします");
  }

  const proxyEnv = settings.networkProxy.useProxy
    ? getProxyEnvironmentValues()
    : { httpProxy: "", httpsProxy: "", noProxy: "" };
  const proxyUrlText = resolveProxyForTarget(targetUrl, proxyEnv);
  await new Promise<void>((resolve, reject) => {
    const finishWithResponse = (statusCode: number | undefined, body: string) => {
      if (statusCode && statusCode >= 200 && statusCode < 300) {
        resolve();
        return;
      }
      reject(new Error(`proxy precheck failed: status=${statusCode ?? "unknown"} body=${body.trim()}`));
    };

    if (!proxyUrlText) {
      const directReq = http.request(
        {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname,
          port: targetUrl.port || "80",
          method: "GET",
          path: `${targetUrl.pathname}${targetUrl.search}`
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => finishWithResponse(res.statusCode, body));
        }
      );
      directReq.on("error", reject);
      directReq.end();
      return;
    }

    const proxyUrl = new URL(proxyUrlText);
    const proxyReq = http.request(
      {
        protocol: proxyUrl.protocol,
        hostname: proxyUrl.hostname,
        port: proxyUrl.port || (proxyUrl.protocol === "https:" ? "443" : "80"),
        method: "GET",
        path: targetUrl.toString(),
        headers: {
          host: targetUrl.host
        }
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => finishWithResponse(res.statusCode, body));
      }
    );
    proxyReq.on("error", reject);
    proxyReq.end();
  });
}

function withScopedProxyEnvironment(settings: ProviderSettings): () => void {
  const source = settings.networkProxy.useProxy
    ? getProxyEnvironmentValues()
    : { httpProxy: "", httpsProxy: "", noProxy: "" };
  const targetEntries: Array<[string, string]> = [
    ["HTTP_PROXY", source.httpProxy],
    ["http_proxy", source.httpProxy],
    ["HTTPS_PROXY", source.httpsProxy],
    ["https_proxy", source.httpsProxy],
    ["NO_PROXY", source.noProxy],
    ["no_proxy", source.noProxy]
  ];
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of targetEntries) {
    previous.set(key, process.env[key]);
    if (value) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
  return () => {
    for (const [key, prevValue] of previous.entries()) {
      if (prevValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prevValue;
      }
    }
  };
}

export class AgentRuntime {
  private readonly createSession: (options: { apiKey: string | null; model?: PiModel; cwd?: string }) => Promise<PiSession>;
  private readonly authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
  private readonly logger: Logger;
  private readonly workspaceDir?: string;
  private readonly availableSkillNames: Set<string>;
  private readonly knownSkillNames: Set<string>;
  private readonly knownSkillNameFingerprints: Set<string>;
  private readonly suppressedProposalFingerprints = new Set<string>();
  private readonly conversationHistory: ConversationTurn[] = [];
  private pendingHeartbeatProposal: HeartbeatSkillProposal | null = null;
  private isSessionPromptActive = false;
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
    this.knownSkillNames = new Set(availableSkills.map((skill) => skill.name));
    this.knownSkillNameFingerprints = new Set(
      Array.from(this.knownSkillNames).map((name) => normalizeSimilarityText(name.replace(/-/g, "")))
    );
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
    providerSettings: ProviderSettings,
    hooks?: { requestId: string; onLoopEvent?: (event: AgentLoopEvent) => void }
  ): Promise<AgentResult> {
    if (this.isSessionPromptActive) {
      return {
        ok: false,
        error: {
          code: "AGENT_BUSY",
          message: "エージェントが別リクエストを処理中です。しばらく待って再試行してください。",
          details: null,
          retryable: true
        }
      };
    }
    this.isSessionPromptActive = true;
    const restoreProxyEnv = withScopedProxyEnvironment(providerSettings);
    try {
      const session = await this.ensureSession(options);
      let streamOutput = "";
      let finalOutput = "";
      let thinkingDeltaSeenInBlock = false;

      const unsubscribe = session.subscribe((event) => {
        const assistantEventType = event.type === "message_update" ? event.assistantMessageEvent?.type : undefined;

        if (hooks?.onLoopEvent) {
          if (event.type === "thinking_start" || assistantEventType === "thinking_start") {
            thinkingDeltaSeenInBlock = false;
            hooks.onLoopEvent({ type: "thinking_start", requestId: hooks.requestId });
          } else if (
            (event.type === "thinking_delta" && typeof event.delta === "string") ||
            (assistantEventType === "thinking_delta" && typeof event.assistantMessageEvent?.delta === "string")
          ) {
            const thinkingDelta = event.type === "thinking_delta" ? event.delta : event.assistantMessageEvent?.delta;
            if (!thinkingDelta) return;
            thinkingDeltaSeenInBlock = true;
            hooks.onLoopEvent({
              type: "thinking_delta",
              requestId: hooks.requestId,
              delta: thinkingDelta
            });
          } else if (event.type === "thinking_end" || assistantEventType === "thinking_end") {
            const thinkingContent =
              event.type === "thinking_end" ? event.content : event.assistantMessageEvent?.content;
            if (!thinkingDeltaSeenInBlock && typeof thinkingContent === "string" && thinkingContent.trim()) {
              hooks.onLoopEvent({
                type: "thinking_delta",
                requestId: hooks.requestId,
                delta: thinkingContent
              });
            }
            thinkingDeltaSeenInBlock = false;
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
    } finally {
      restoreProxyEnv();
      this.isSessionPromptActive = false;
    }
  }

  private buildPromptWithSkillHint(text: string): string {
    if (text.trimStart().startsWith("/skill:")) {
      return text;
    }

    if (this.availableSkillNames.has("skill-creator") && shouldPrioritizeSkillCreator(text)) {
      return `/skill:skill-creator\n\n${text}`;
    }

    if (this.availableSkillNames.has("agent-browser") && shouldPrioritizeAgentBrowser(text)) {
      return `/skill:agent-browser\n\n${text}`;
    }

    return text;
  }

  private recordConversationTurn(userText: string, assistantText: string): void {
    this.conversationHistory.push({
      userText,
      assistantText,
      completedAt: Date.now()
    });
    if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
      this.conversationHistory.splice(0, this.conversationHistory.length - MAX_CONVERSATION_HISTORY);
    }
  }

  private isLikelyDuplicateProposal(proposal: HeartbeatSkillProposal): boolean {
    if (this.knownSkillNames.has(proposal.skillName)) return true;
    if (this.suppressedProposalFingerprints.has(proposal.fingerprint)) return true;

    for (const fingerprint of this.knownSkillNameFingerprints) {
      if (!fingerprint || fingerprint.length < 4) continue;
      if (proposal.fingerprint.includes(fingerprint) || fingerprint.includes(proposal.fingerprint)) {
        return true;
      }
    }

    return false;
  }

  private buildHeartbeatProposalFromHistory(now = Date.now()): HeartbeatSkillProposal | null {
    const latestTurn = this.conversationHistory.at(-1);
    if (!latestTurn) return null;
    if (now - latestTurn.completedAt < getHeartbeatProposalDelayMs()) return null;
    if (!indicatesSessionCompletion(latestTurn.userText)) return null;

    const summary = truncateSummary(latestTurn.assistantText);
    if (!summary) return null;

    const fingerprint = normalizeSimilarityText(summary);
    if (!fingerprint) return null;

    const skillName = `session-playbook-${createStableHash(fingerprint)}`;
    return {
      skillName,
      description: truncateSummary(`セッションから抽出した再利用手順: ${summary}`, 120),
      summary,
      fingerprint,
      createdAt: now
    };
  }

  private buildSkillCreatorPrompt(proposal: HeartbeatSkillProposal): string {
    return [
      "/skill:skill-creator",
      "",
      "以下の再利用手順をスキルとして保存してください。",
      `- skillName: ${proposal.skillName}`,
      `- description: ${proposal.description}`,
      `- sourceSummary: ${proposal.summary}`,
      "- 既存スキルと同等なら新規作成しないで理由を返してください。",
      "- 保存先は ~/.pi/skills/<skill-name>/SKILL.md にしてください。"
    ].join("\n");
  }

  private buildLiltobookHeartbeatPrompt(heartbeatMarkdown: string, latestTurn: ConversationTurn): string {
    return [
      "/skill:liltobook",
      "",
      heartbeatMarkdown.trim(),
      "",
      "最近の会話履歴を参照し、再利用可能な内容があれば skill-creator の適用候補を抽出してください。",
      "会話抜粋:",
      `ユーザー: ${truncateSummary(latestTurn.userText, 160)}`,
      `アシスタント: ${truncateSummary(latestTurn.assistantText, 220)}`
    ].join("\n");
  }

  private async runPromptWithProvider(
    text: string,
    providerSettings: ProviderSettings,
    hooks?: { requestId: string; onLoopEvent?: (event: AgentLoopEvent) => void }
  ): Promise<AgentResult> {
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
      return await this.runSessionPrompt(text, { apiKey, model, ...runOptionsBase }, providerSettings, hooks);
    }

    const authState = this.authService.getState() as AuthSnapshot;
    if (authState.phase !== "authenticated" || authState.provider !== providerSettings.oauthProvider) {
      return {
        ok: false,
        error: {
          code: "AUTH_REQUIRED",
          message: `${providerSettings.oauthProvider} の OAuth 認証が必要です。`,
          details: null,
          retryable: true
        }
      };
    }

    const apiKey = await this.authService.getApiKey(providerSettings.oauthProvider);
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

    return await this.runSessionPrompt(text, { apiKey, model: undefined, ...runOptionsBase }, providerSettings, hooks);
  }

  private async maybeHandlePendingHeartbeatProposal(
    text: string,
    providerSettings: ProviderSettings,
    hooks?: { requestId: string; onLoopEvent?: (event: AgentLoopEvent) => void }
  ): Promise<AgentResult | null> {
    if (!this.pendingHeartbeatProposal) return null;
    if (text.trimStart().startsWith("/skill:")) return null;

    if (isRejectText(text)) {
      this.suppressedProposalFingerprints.add(this.pendingHeartbeatProposal.fingerprint);
      this.pendingHeartbeatProposal = null;
      return { ok: true, text: "スキル化提案をキャンセルしました。" };
    }

    if (!isApprovalText(text)) {
      const proposal = this.pendingHeartbeatProposal;
      return {
        ok: true,
        text:
          `再利用スキル候補を提案します: ${proposal.skillName}\n` +
          `概要: ${proposal.description}\n` +
          "作成してよければ「はい」、見送る場合は「いいえ」と返答してください。"
      };
    }

    const proposal = this.pendingHeartbeatProposal;
    if (this.isLikelyDuplicateProposal(proposal)) {
      this.suppressedProposalFingerprints.add(proposal.fingerprint);
      this.pendingHeartbeatProposal = null;
      return { ok: true, text: "既存スキルと重複するため、新規作成は行いませんでした。" };
    }

    const result = await this.runPromptWithProvider(this.buildSkillCreatorPrompt(proposal), providerSettings, hooks);
    if (!result.ok) return result;

    this.knownSkillNames.add(proposal.skillName);
    this.knownSkillNameFingerprints.add(normalizeSimilarityText(proposal.skillName.replace(/-/g, "")));
    this.suppressedProposalFingerprints.add(proposal.fingerprint);
    this.pendingHeartbeatProposal = null;

    return {
      ok: true,
      text: `${result.text}\n\n[liltobook] 承認を受けてスキルを作成しました: ${proposal.skillName}`
    };
  }

  async runLiltobookHeartbeat(options: {
    heartbeatMarkdown: string;
    providerSettings: ProviderSettings;
    now?: number;
  }): Promise<{ status: "skipped" | "proposed"; reason?: string; skillName?: string }> {
    const now = options.now ?? Date.now();
    if (!this.availableSkillNames.has("liltobook")) return { status: "skipped", reason: "missing_liltobook_skill" };
    if (!this.availableSkillNames.has("skill-creator")) return { status: "skipped", reason: "missing_skill_creator" };
    if (this.isSessionPromptActive) return { status: "skipped", reason: "agent_busy" };
    if (this.pendingHeartbeatProposal) return { status: "skipped", reason: "awaiting_user_approval" };

    const proposal = this.buildHeartbeatProposalFromHistory(now);
    if (!proposal) return { status: "skipped", reason: "no_reusable_candidate" };
    if (this.isLikelyDuplicateProposal(proposal)) {
      this.suppressedProposalFingerprints.add(proposal.fingerprint);
      return { status: "skipped", reason: "duplicate_candidate" };
    }

    const latestTurn = this.conversationHistory.at(-1);
    if (!latestTurn) return { status: "skipped", reason: "no_conversation_history" };

    const prompt = this.buildLiltobookHeartbeatPrompt(options.heartbeatMarkdown, latestTurn);
    const heartbeatResult = await this.runPromptWithProvider(prompt, options.providerSettings);
    if (!heartbeatResult.ok) {
      if (heartbeatResult.error.code === "AGENT_BUSY") {
        return { status: "skipped", reason: "agent_busy" };
      }
      return { status: "skipped", reason: heartbeatResult.error.code };
    }

    this.pendingHeartbeatProposal = proposal;
    return { status: "proposed", skillName: proposal.skillName };
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
      const pendingHandled = await this.maybeHandlePendingHeartbeatProposal(text, providerSettings, hooks);
      if (pendingHandled) {
        if (pendingHandled.ok) {
          this.recordConversationTurn(text, pendingHandled.text);
        }
        return pendingHandled;
      }

      if (process.env.LILTO_E2E_MOCK === "1") {
        try {
          await runProxyPrecheckIfEnabled(providerSettings);
        } catch (error) {
          return {
            ok: false,
            error: standardizeError(error, "PROXY_CONNECTION_FAILED")
          };
        }
        if (hooks?.onLoopEvent) {
          const pause = async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
          };

          hooks.onLoopEvent({ type: "thinking_start", requestId: hooks.requestId });
          await pause();
          hooks.onLoopEvent({
            type: "thinking_delta",
            requestId: hooks.requestId,
            delta: "要求を分解し、必要な手順を確認します。\n"
          });
          await pause();
          hooks.onLoopEvent({
            type: "thinking_delta",
            requestId: hooks.requestId,
            delta: "読み取りとコマンド実行の順で進めます。\n"
          });
          await pause();
          hooks.onLoopEvent({ type: "thinking_end", requestId: hooks.requestId });
          await pause();

          hooks.onLoopEvent({
            type: "tool_execution_start",
            requestId: hooks.requestId,
            toolCallId: "mock-read-1",
            toolName: "read_file",
            args: { command: "read_file README.md" }
          });
          await pause();
          hooks.onLoopEvent({
            type: "tool_execution_end",
            requestId: hooks.requestId,
            toolCallId: "mock-read-1",
            toolName: "read_file",
            isError: false
          });
          await pause();

          hooks.onLoopEvent({
            type: "tool_execution_start",
            requestId: hooks.requestId,
            toolCallId: "mock-run-1",
            toolName: "run_in_terminal",
            args: { command: "npm run check" }
          });
          await pause();
          hooks.onLoopEvent({
            type: "tool_execution_end",
            requestId: hooks.requestId,
            toolCallId: "mock-run-1",
            toolName: "run_in_terminal",
            isError: false
          });
          await pause();
        }

        const mock = `[E2E_MOCK_FINAL] 要求「${text}」を処理し、複数コマンドを実行して回答しました。`;
        this.logger.info("agent_prompt_mock_completed", { outputLength: mock.length });
        this.recordConversationTurn(text, mock);
        return { ok: true, text: mock };
      }

      const promptText = this.buildPromptWithSkillHint(text);
      const result = await this.runPromptWithProvider(promptText, providerSettings, hooks);
      if (result.ok) {
        this.recordConversationTurn(text, result.text);
      }
      return result;
    } catch (error) {
      const normalized = standardizeAgentRuntimeError(error);
      this.logger.error("agent_prompt_failed", normalized);
      return { ok: false, error: normalized };
    }
  }
}

// Backward-compatible alias for existing imports.
export { AgentRuntime as PiAgentBridge };
