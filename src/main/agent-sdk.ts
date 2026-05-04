import http from "node:http";
import path from "node:path";
import { createLogger, type Logger } from "./logger";
import type { ClaudeAuthService } from "./auth-service";
import type { ProviderSettings } from "./provider-settings";
import { isCustomProviderReady } from "./provider-settings";
import type { SchedulerBridgeServer } from "./scheduler-bridge";
import { resolveCronMcpServerPath, resolvePackagedCodexBinary } from "./app-paths";
import type { AgentLoopEvent } from "../shared/agent-loop";

type CodexConfig = Record<string, unknown>;

type SessionThreadOptions = {
  sandboxMode: "danger-full-access" | "workspace-write";
  config?: CodexConfig;
};

type AgentError = {
  code: string;
  message: string;
  details: string | null;
  retryable: boolean;
};

type AgentSuccess = { ok: true; text: string };
type AgentFailure = { ok: false; error: AgentError };
export type AgentResult = AgentSuccess | AgentFailure;

type RuntimeModel = {
  id: string;
  baseUrl?: string;
};

type Thread = {
  id: string | null;
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
};

type ThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "error"; message: string }
  | { type: "item.started" | "item.updated" | "item.completed"; item: ThreadItem }
  | { type: string };

type ThreadItem =
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "command_execution"; command: string; status: "in_progress" | "completed" | "failed" }
  | { id: string; type: "mcp_tool_call"; tool: string; server: string; arguments: unknown; status: "in_progress" | "completed" | "failed" }
  | { id: string; type: "error"; message?: string; text?: string; error?: { message?: string; code?: string } }
  | { id: string; type: string };

type CodexSession = {
  signature: string;
  thread: Thread;
};

const EVENT_LOG_PREVIEW_LIMIT = 160;
const OAUTH_MODEL_IDS = new Set(["gpt-5.3-codex"]);
const SCHEDULER_FOLLOW_UP_PROMPT_PREFIX = "以下はこの会話で発火した scheduler 通知です。";
const SCHEDULER_PROMPT_GUIDANCE = [
  "[Scheduler execution rule]",
  "If this request is about reminding/notifying later or on a schedule, you MUST use the `cron` MCP tool.",
  "The `cron` MCP tool is available in this session, so call it directly.",
  "Do not check MCP availability with resource-listing tools before calling `cron`.",
  "Never use sleep, long-running shell commands, background jobs, cron CLI, or polling to wait for time to pass.",
  "Use `set_timer` for relative times like seconds/minutes/hours later.",
  "Use `set_reminder_at` for a specific date/time and `set_daily_reminder` for daily repeats.",
  "After scheduling, briefly confirm what was scheduled."
].join("\n");
const JAPANESE_SCHEDULER_PATTERN =
  /(?:\d+\s*(?:秒|分|時間)後|今日|きょう|明日|あした|毎日|毎週|毎朝|毎晩|\d+\s*時(?:\d+\s*分)?(?:に|から|まで)|リマインド|通知|タイマー|アラーム|おしえて|教えて)/;
const ENGLISH_SCHEDULER_PATTERN =
  /\b(?:remind|reminder|notify|notification|timer|alarm|later|after|tomorrow|today|daily|every day|every week|in \d+\s*(?:second|seconds|minute|minutes|hour|hours))\b/i;
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

function standardizeExecutionError(error: unknown): AgentError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("proxy precheck failed")) {
    return standardizeError(error, "PROXY_CONNECTION_FAILED", true);
  }
  const lowered = message.toLowerCase();
  if (lowered.includes("sandbox setup required") || lowered.includes("setup is missing or out of date")) {
    return standardizeError(error, "WINDOWS_SANDBOX_SETUP_REQUIRED", true);
  }
  if (lowered.includes("restricted read-only access is not yet supported") || lowered.includes("only available on windows")) {
    return standardizeError(error, "WINDOWS_SANDBOX_UNSUPPORTED_MODE", false);
  }
  if (lowered.includes("windows sandbox")) {
    return standardizeError(error, "WINDOWS_SANDBOX_SETUP_FAILED", true);
  }
  return standardizeError(error);
}

function previewForLog(text: string): string {
  if (!text.trim()) {
    return "";
  }
  return text.length > EVENT_LOG_PREVIEW_LIMIT ? `${text.slice(0, EVENT_LOG_PREVIEW_LIMIT)}...` : text;
}

function summarizeThreadItem(item: ThreadItem): Record<string, unknown> {
  const typedItem = item as any;
  const payload: Record<string, unknown> = { type: item.type, id: item.id };
  if (item.type === "reasoning" || item.type === "agent_message") {
    payload.preview = previewForLog(typedItem.text ?? "");
  } else if (item.type === "command_execution") {
    payload.command = typedItem.command;
    payload.status = typedItem.status;
  } else if (item.type === "mcp_tool_call") {
    payload.server = typedItem.server;
    payload.tool = typedItem.tool;
    payload.status = typedItem.status;
  } else if (item.type === "error") {
    payload.message = typedItem.message ?? typedItem.error?.message ?? previewForLog(typedItem.text ?? "");
    payload.code = typedItem.error?.code;
  }
  return payload;
}

function extractThreadItemErrorMessage(item: ThreadItem): string {
  const typedItem = item as any;
  if (typeof typedItem.message === "string" && typedItem.message.trim()) {
    return typedItem.message.trim();
  }
  if (typeof typedItem.error?.message === "string" && typedItem.error.message.trim()) {
    return typedItem.error.message.trim();
  }
  if (typeof typedItem.text === "string" && typedItem.text.trim()) {
    return typedItem.text.trim();
  }
  return "Codex runtime returned an error item.";
}

function buildCustomModel(settings: ProviderSettings): RuntimeModel {
  const modelId = settings.customProvider.modelId.trim() || "gpt-5.3-codex";
  const baseUrlInput = settings.customProvider.baseUrl.trim();
  return {
    id: modelId,
    baseUrl: normalizeBaseUrl(baseUrlInput) || undefined
  };
}

function buildOauthModel(settings: ProviderSettings): RuntimeModel {
  const requestedModel = settings.oauthModelId.trim();
  return {
    id: OAUTH_MODEL_IDS.has(requestedModel) ? requestedModel : "gpt-5.3-codex"
  };
}

function mergeCodexConfig(...configs: Array<CodexConfig | undefined>): CodexConfig | undefined {
  const merged: CodexConfig = {};
  for (const config of configs) {
    if (!config) {
      continue;
    }
    for (const [key, value] of Object.entries(config)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        merged[key] &&
        typeof merged[key] === "object" &&
        !Array.isArray(merged[key])
      ) {
        merged[key] = mergeCodexConfig(merged[key] as CodexConfig, value as CodexConfig) ?? {};
        continue;
      }
      merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function shouldForceCronScheduling(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  if (text.includes(SCHEDULER_FOLLOW_UP_PROMPT_PREFIX)) {
    return false;
  }
  return JAPANESE_SCHEDULER_PATTERN.test(text) || ENGLISH_SCHEDULER_PATTERN.test(text);
}

function augmentPromptForScheduler(text: string): string {
  if (!shouldForceCronScheduling(text)) {
    return text;
  }
  return `${text}\n\n${SCHEDULER_PROMPT_GUIDANCE}`;
}

function buildSessionThreadOptions(settings: ProviderSettings, platform: NodeJS.Platform): SessionThreadOptions {
  if (platform === "win32" && settings.windowsSandbox.mode !== "off") {
    return {
      sandboxMode: "workspace-write",
      config: {
        windows: {
          sandbox: settings.windowsSandbox.mode,
          sandbox_private_desktop: settings.windowsSandbox.privateDesktop
        }
      }
    };
  }

  return {
    sandboxMode: "danger-full-access"
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    const isOllamaHost = (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "11434";
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (isOllamaHost && (normalizedPath === "" || normalizedPath === "/")) {
      parsed.pathname = "/v1";
      return parsed.toString().replace(/\/$/, "");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
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

const INITIAL_PROXY_ENVIRONMENT = {
  httpProxy: getProxyValue("HTTP_PROXY", "http_proxy"),
  httpsProxy: getProxyValue("HTTPS_PROXY", "https_proxy"),
  noProxy: getProxyValue("NO_PROXY", "no_proxy")
};

function getProxyEnvironmentValues(): { httpProxy: string; httpsProxy: string; noProxy: string } {
  const current = {
    httpProxy: getProxyValue("HTTP_PROXY", "http_proxy"),
    httpsProxy: getProxyValue("HTTPS_PROXY", "https_proxy"),
    noProxy: getProxyValue("NO_PROXY", "no_proxy")
  };
  return {
    httpProxy: current.httpProxy || INITIAL_PROXY_ENVIRONMENT.httpProxy,
    httpsProxy: current.httpsProxy || INITIAL_PROXY_ENVIRONMENT.httpsProxy,
    noProxy: current.noProxy || INITIAL_PROXY_ENVIRONMENT.noProxy
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

function buildCodexSdkEnvironment(options: {
  codexHomeDir?: string;
}): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  if (options.codexHomeDir) {
    env.CODEX_HOME = options.codexHomeDir;
  }
  return env;
}

export async function createCodexThreadFromSdk(options: {
  apiKey: string | null;
  model?: RuntimeModel;
  cwd?: string;
  threadId?: string;
  additionalDirectories?: string[];
  codexHomeDir?: string;
  homeDir?: string;
  schedulerBridge?: SchedulerBridgeServer;
  schedulerSessionId?: string;
  sandboxMode?: "danger-full-access" | "workspace-write";
  config?: CodexConfig;
}): Promise<Thread> {
  const { Codex } = (await importEsm("@openai/codex-sdk")) as {
    Codex: new (options: {
      apiKey?: string;
      baseUrl?: string;
      env?: Record<string, string>;
      codexPathOverride?: string;
      config?: Record<string, unknown>;
    }) => {
      startThread: (options: Record<string, unknown>) => Thread;
      resumeThread: (id: string, options: Record<string, unknown>) => Thread;
    };
  };
  const env = buildCodexSdkEnvironment({ codexHomeDir: options.codexHomeDir });
  const packagedCodex = resolvePackagedCodexBinary();
  if (packagedCodex?.extraPath) {
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    env.PATH = [packagedCodex.extraPath, ...(env.PATH ?? "").split(pathSeparator).filter(Boolean)].join(pathSeparator);
  }
  const bridgeEnv = options.schedulerBridge
    ? options.schedulerBridge.getBridgeEnv(options.schedulerSessionId ?? "default")
    : {};
  if (options.schedulerBridge) {
    // Pass bridge env vars into the Codex CLI process so MCP subprocesses inherit them
    Object.assign(env, bridgeEnv);
    if (process.versions.electron) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }
  }
  const mcpConfig = options.schedulerBridge
    ? {
        mcp_servers: {
          cron: {
            command: process.execPath,
            args: [resolveCronMcpServerPath()],
            env: {
              ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
              ...bridgeEnv
            },
            enabled: true
          }
        }
      }
    : undefined;
  const codex = new Codex({
    apiKey: options.apiKey ?? undefined,
    baseUrl: options.model?.baseUrl,
    env,
    codexPathOverride: packagedCodex?.command,
    config: mergeCodexConfig(mcpConfig, options.config)
  });
  const threadOptions = {
    model: options.model?.id,
    workingDirectory: options.cwd ?? process.cwd(),
    additionalDirectories: options.additionalDirectories ?? [],
    sandboxMode: options.sandboxMode ?? "danger-full-access",
    approvalPolicy: "never" as const,
    networkAccessEnabled: true,
    skipGitRepoCheck: true
  };
  return options.threadId ? codex.resumeThread(options.threadId, threadOptions) : codex.startThread(threadOptions);
}

export class AgentRuntime {
  private readonly createSession: (options: {
    apiKey: string | null;
    model?: RuntimeModel;
    cwd?: string;
    threadId?: string;
    additionalDirectories?: string[];
    codexHomeDir?: string;
    homeDir?: string;
    schedulerBridge?: SchedulerBridgeServer;
    schedulerSessionId?: string;
    sandboxMode?: "danger-full-access" | "workspace-write";
    config?: CodexConfig;
  }) => Promise<Thread>;
  private readonly authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
  private readonly logger: Logger;
  private readonly workspaceDir?: string;
  private readonly codexHomeDir?: string;
  private readonly homeDir?: string;
  private readonly schedulerBridge?: SchedulerBridgeServer;
  private readonly platform: NodeJS.Platform;
  private readonly sessionCache = new Map<string, CodexSession>();
  private readonly conversationThreads = new Map<string, string>();
  private currentAbortController: AbortController | null = null;

  constructor({
    createSession = createCodexThreadFromSdk,
    authService,
    workspaceDir,
    codexHomeDir,
    homeDir,
    schedulerBridge,
    platform = process.platform,
    logger = createLogger("agent")
  }: {
    createSession?: (options: {
      apiKey: string | null;
      model?: RuntimeModel;
      cwd?: string;
      threadId?: string;
      additionalDirectories?: string[];
      codexHomeDir?: string;
      homeDir?: string;
      schedulerBridge?: SchedulerBridgeServer;
      schedulerSessionId?: string;
      sandboxMode?: "danger-full-access" | "workspace-write";
      config?: CodexConfig;
    }) => Promise<Thread>;
    authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
    workspaceDir?: string;
    codexHomeDir?: string;
    homeDir?: string;
    availableSkills?: Array<{ name: string }>;
    schedulerBridge?: SchedulerBridgeServer;
    platform?: NodeJS.Platform;
    logger?: Logger;
  }) {
    this.createSession = createSession;
    this.authService = authService;
    this.logger = logger;
    this.workspaceDir = workspaceDir;
    this.codexHomeDir = codexHomeDir;
    this.homeDir = homeDir;
    this.schedulerBridge = schedulerBridge;
    this.platform = platform;
  }

  abort(): void {
    this.currentAbortController?.abort();
    this.currentAbortController = null;
  }

  refreshSkills(_skills?: Array<{ name: string }>): void {
    this.invalidateSession();
  }

  refreshPlugins(): void {
    this.invalidateSession();
  }

  refreshProviderSettings(): void {
    this.invalidateSession();
  }

  private invalidateSession(): void {
    this.sessionCache.clear();
  }

  private getAdditionalDirectories(cwd: string): string[] {
    const dirs = new Set<string>();
    dirs.add(cwd);
    if (process.cwd() !== cwd) {
      dirs.add(process.cwd());
    }
    return [...dirs];
  }

  private async ensureSession(options: {
    apiKey: string | null;
    model?: RuntimeModel;
    cwd?: string;
    conversationId?: string;
    backendSessionId?: string;
    threadOptions: SessionThreadOptions;
  }): Promise<CodexSession> {
    const cwd = options.cwd ?? process.cwd();
    const threadId =
      (options.conversationId ? this.conversationThreads.get(options.conversationId) : undefined)
      ?? options.backendSessionId;
    const signature = JSON.stringify({
      conversationId: options.conversationId ?? "default",
      apiKey: options.apiKey ?? "",
      modelId: options.model?.id ?? "",
      baseUrl: options.model?.baseUrl ?? "",
      sandboxMode: options.threadOptions.sandboxMode,
      config: options.threadOptions.config ?? null,
      cwd
    });
    const existing = this.sessionCache.get(signature);
    if (existing) {
      return existing;
    }

    const thread = await this.createSession({
      apiKey: options.apiKey,
      model: options.model,
      cwd,
      threadId,
      additionalDirectories: this.getAdditionalDirectories(cwd),
      codexHomeDir: this.codexHomeDir,
      homeDir: this.homeDir,
      schedulerBridge: this.schedulerBridge,
      schedulerSessionId: threadId ?? options.conversationId ?? "default",
      sandboxMode: options.threadOptions.sandboxMode,
      config: options.threadOptions.config
    });
    const session = { signature, thread };
    this.sessionCache.set(signature, session);
    return session;
  }

  private handleThreadEvent(
    event: ThreadEvent,
    state: {
      requestId: string;
      conversationId?: string;
      textByItemId: Map<string, string>;
      textOutput: string;
      thinkingActive: Set<string>;
    },
    hooks?: { requestId: string; conversationId?: string; onLoopEvent?: (event: AgentLoopEvent) => void }
  ): { textOutput: string; fatalError?: string } {
    if (event.type === "thread.started") {
      const started = event as { thread_id: string };
      if (hooks?.conversationId) {
        this.conversationThreads.set(hooks.conversationId, started.thread_id);
      }
      hooks?.onLoopEvent?.({
        type: "session_bound",
        requestId: state.requestId,
        conversationId: hooks?.conversationId,
        agentSessionId: started.thread_id
      });
      return { textOutput: state.textOutput };
    }

    if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
      return { textOutput: state.textOutput };
    }

    const item = (event as { item: ThreadItem }).item;
    const typedItem = item as any;
    this.logger.info("agent_item_event", summarizeThreadItem(item));

    if (item.type === "reasoning") {
      const previous = state.textByItemId.get(item.id) ?? "";
      const next = typedItem.text ?? "";
      if (!state.thinkingActive.has(item.id)) {
        state.thinkingActive.add(item.id);
        hooks?.onLoopEvent?.({ type: "thinking_start", requestId: state.requestId });
      }
      const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
      if (delta) {
        hooks?.onLoopEvent?.({ type: "thinking_delta", requestId: state.requestId, delta });
      }
      state.textByItemId.set(item.id, next);
      if (event.type === "item.completed") {
        state.thinkingActive.delete(item.id);
        hooks?.onLoopEvent?.({ type: "thinking_end", requestId: state.requestId });
      }
      return { textOutput: state.textOutput };
    }

    if (item.type === "command_execution") {
      if (event.type === "item.started") {
        hooks?.onLoopEvent?.({
          type: "tool_execution_start",
          requestId: state.requestId,
          toolCallId: item.id,
          toolName: "shell",
          args: { command: typedItem.command }
        });
      }
      if (event.type === "item.completed") {
        hooks?.onLoopEvent?.({
          type: "tool_execution_end",
          requestId: state.requestId,
          toolCallId: item.id,
          toolName: "shell",
          isError: typedItem.status === "failed"
        });
      }
      return { textOutput: state.textOutput };
    }

    if (item.type === "mcp_tool_call") {
      if (event.type === "item.started") {
        hooks?.onLoopEvent?.({
          type: "tool_execution_start",
          requestId: state.requestId,
          toolCallId: item.id,
          toolName: typedItem.tool,
          args: typedItem.arguments
        });
      }
      if (event.type === "item.completed") {
        hooks?.onLoopEvent?.({
          type: "tool_execution_end",
          requestId: state.requestId,
          toolCallId: item.id,
          toolName: typedItem.tool,
          isError: typedItem.status === "failed"
        });
      }
      return { textOutput: state.textOutput };
    }

    if (item.type === "agent_message") {
      const previous = state.textByItemId.get(item.id) ?? "";
      const next = typedItem.text ?? "";
      const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
      if (delta) {
        hooks?.onLoopEvent?.({ type: "text_delta", requestId: state.requestId, delta });
      }
      state.textByItemId.set(item.id, next);
      return { textOutput: next || state.textOutput };
    }

    if (item.type === "error" && event.type === "item.completed") {
      const message = extractThreadItemErrorMessage(item);
      this.logger.error("agent_item_error", item);
      return { textOutput: state.textOutput, fatalError: message };
    }

    return { textOutput: state.textOutput };
  }

  private async runSessionPrompt(
    text: string,
    options: { apiKey: string | null; model?: RuntimeModel; cwd?: string; conversationId?: string; backendSessionId?: string },
    providerSettings: ProviderSettings,
    hooks?: {
      requestId: string;
      conversationId?: string;
      onLoopEvent?: (event: AgentLoopEvent) => void;
      mode?: "default" | "heartbeat";
    }
  ): Promise<AgentResult> {
    const restoreProxyEnv = withScopedProxyEnvironment(providerSettings);
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    try {
      const session = await this.ensureSession({
        ...options,
        threadOptions: buildSessionThreadOptions(providerSettings, this.platform)
      });
      if (session.thread.id && hooks?.onLoopEvent) {
        hooks.onLoopEvent({
          type: "session_bound",
          requestId: hooks.requestId,
          conversationId: hooks.conversationId,
          agentSessionId: session.thread.id
        });
      }

      const prompt = hooks?.mode === "heartbeat" ? text : augmentPromptForScheduler(text);
      const streamed = await session.thread.runStreamed(prompt, { signal: abortController.signal });
      const state = {
        requestId: hooks?.requestId ?? "request",
        conversationId: hooks?.conversationId,
        textByItemId: new Map<string, string>(),
        textOutput: "",
        thinkingActive: new Set<string>()
      };

      for await (const event of streamed.events) {
        if (event.type === "turn.failed") {
          throw new Error((event as { error: { message: string } }).error.message);
        }
        if (event.type === "error") {
          throw new Error((event as { message: string }).message);
        }
        const next = this.handleThreadEvent(event, state, hooks);
        if (next.fatalError) {
          throw new Error(next.fatalError);
        }
        state.textOutput = next.textOutput;
      }

      const output = state.textOutput.trim() ? state.textOutput : "エージェント応答は空でした。";
      return { ok: true, text: output };
    } catch (error) {
      if (abortController.signal.aborted) {
        return {
          ok: false,
          error: { code: "ABORTED", message: "中断しました", details: null, retryable: false }
        };
      }
      throw error;
    } finally {
      restoreProxyEnv();
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
      }
    }
  }

  async submitPrompt(
    text: string,
    providerSettings: ProviderSettings,
    hooks?: {
      requestId: string;
      conversationId?: string;
      backendSessionId?: string;
      onLoopEvent?: (event: AgentLoopEvent) => void;
      mode?: "default" | "heartbeat";
    }
  ): Promise<AgentResult> {
    try {
      if (process.env.LILTO_E2E_MOCK === "1") {
        await runProxyPrecheckIfEnabled(providerSettings);
        if (hooks?.onLoopEvent) {
          hooks.onLoopEvent({
            type: "session_bound",
            requestId: hooks.requestId,
            conversationId: hooks.conversationId,
            agentSessionId: hooks.conversationId ?? "e2e-mock-session"
          });
          hooks.onLoopEvent({
            type: "tool_execution_start",
            requestId: hooks.requestId,
            toolCallId: "e2e-read-file",
            toolName: "shell",
            args: { command: "Running command: read_file" }
          });
          hooks.onLoopEvent({
            type: "tool_execution_end",
            requestId: hooks.requestId,
            toolCallId: "e2e-read-file",
            toolName: "shell",
            isError: false
          });
          hooks.onLoopEvent({
            type: "tool_execution_start",
            requestId: hooks.requestId,
            toolCallId: "e2e-run-terminal",
            toolName: "shell",
            args: { command: "Running command: run_in_terminal" }
          });
          hooks.onLoopEvent({
            type: "tool_execution_end",
            requestId: hooks.requestId,
            toolCallId: "e2e-run-terminal",
            toolName: "shell",
            isError: false
          });
        }
        return { ok: true, text: `[E2E_MOCK_FINAL] 要求「${text}」を処理し、複数コマンドを実行して回答しました。` };
      }

      const runOptionsBase = { cwd: this.workspaceDir };

      if (this.platform !== "win32" && providerSettings.windowsSandbox.mode !== "off") {
        return {
          ok: false,
          error: {
            code: "WINDOWS_SANDBOX_UNSUPPORTED_MODE",
            message: "Windows sandbox は Windows でのみ利用できます。",
            details: null,
            retryable: false
          }
        };
      }

      if (providerSettings.activeProvider === "custom-openai-completions") {
        if (!isCustomProviderReady(providerSettings)) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_CONFIG_REQUIRED",
              message: "API key を使うには API key の設定が必要です。",
              details: null,
              retryable: true
            }
          };
        }

        const model = buildCustomModel(providerSettings);
        const apiKey = providerSettings.customProvider.apiKey.trim() || (model.baseUrl && isLocalOllamaUrl(model.baseUrl) ? "ollama" : "");
        if (!apiKey) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_CONFIG_REQUIRED",
              message: "API key を入力してください。",
              details: null,
              retryable: true
            }
          };
        }

        return await this.runSessionPrompt(
          text,
          { apiKey, model, conversationId: hooks?.conversationId, backendSessionId: hooks?.backendSessionId, ...runOptionsBase },
          providerSettings,
          hooks
        );
      }

      const authState = this.authService.getState();
      if (authState.phase !== "authenticated") {
        return {
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "Codex ChatGPT 認証が必要です。",
            details: null,
            retryable: true
          }
        };
      }

      return await this.runSessionPrompt(
        text,
        {
          apiKey: null,
          model: buildOauthModel(providerSettings),
          conversationId: hooks?.conversationId,
          backendSessionId: hooks?.backendSessionId,
          ...runOptionsBase
        },
        providerSettings,
        hooks
      );
    } catch (error) {
      const normalized = standardizeExecutionError(error);
      this.logger.error("agent_prompt_failed", normalized);
      return { ok: false, error: normalized };
    }
  }
}

export { AgentRuntime as PiAgentBridge };
export { buildCodexSdkEnvironment as buildCodexSdkEnvironmentForTest };
