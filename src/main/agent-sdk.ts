import http from "node:http";
import path from "node:path";
import { createLogger, type Logger } from "./logger";
import { buildCustomModel, buildOauthModel, buildSessionThreadOptions, isLocalOllamaUrl, mergeCodexConfig, augmentPromptForScheduler, SCHEDULER_FOLLOW_UP_PROMPT_PREFIX, AUXILIARY_THREAD_SERVICE_NAME } from "./agent-sdk-config";
import { standardizeExecutionError } from "./agent-sdk-errors";
import { processThreadEvent, translateAppServerItem } from "./agent-sdk-event-processing";
import type { AgentResult, CodexConfig, RuntimeModel, SessionThreadOptions, Thread, ThreadEvent, ThreadItem } from "./agent-sdk-types";
import type { ClaudeAuthService } from "./auth-service";
import type { ProviderSettings } from "./provider-settings";
import { isCustomProviderReady } from "./provider-settings";
import { CodexAppServerClient } from "./codex-app-server-client";
import type { SchedulerBridgeServer } from "./scheduler-bridge";
import { resolveCodexProcessEnvironment, WINDOWS_POWERSHELL_PATHS } from "./codex-environment";
import { resolveCronMcpServerPath, resolvePackagedCodexBinary } from "./app-paths";
import type { AgentLoopEvent } from "../shared/agent-loop";
type CodexSession = {
  signature: string;
  thread: Thread;
};
const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

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
  if (process.env.LILTO_E2E_MOCK === "1") {
    const bypassed = shouldBypassProxyForHost(targetUrl.hostname, proxyEnv.noProxy);
    console.log(
      `[e2e] proxy precheck enabled=${settings.networkProxy.useProxy} configured=${Boolean(proxyEnv.httpProxy || proxyEnv.httpsProxy)} bypassed=${bypassed} route=${proxyUrlText ? "proxy" : "direct"}`
    );
  }
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
}, dependencies?: {
  createCodex?: (options: {
    apiKey?: string;
    baseUrl?: string;
    env?: Record<string, string>;
    codexPathOverride?: string;
    config?: Record<string, unknown>;
  }) => {
    startThread: (options: Record<string, unknown>) => Thread;
    resumeThread: (id: string, options: Record<string, unknown>) => Thread;
  };
  resolveEnvironment?: typeof resolveCodexProcessEnvironment;
}): Promise<Thread> {
  const createCodex = dependencies?.createCodex ?? (() => {
    throw new Error("unreachable");
  });
  const resolvedCreateCodex = dependencies?.createCodex
    ? createCodex
    : (() => {
        let loadedCodex:
          | (new (options: {
              apiKey?: string;
              baseUrl?: string;
              env?: Record<string, string>;
              codexPathOverride?: string;
              config?: Record<string, unknown>;
            }) => {
              startThread: (options: Record<string, unknown>) => Thread;
              resumeThread: (id: string, options: Record<string, unknown>) => Thread;
            })
          | null = null;
        return async (options: {
          apiKey?: string;
          baseUrl?: string;
          env?: Record<string, string>;
          codexPathOverride?: string;
          config?: Record<string, unknown>;
        }) => {
          if (!loadedCodex) {
            loadedCodex = ((await importEsm("@openai/codex-sdk")) as {
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
            }).Codex;
          }
          return new loadedCodex(options);
        };
      })();
  const packagedCodex = resolvePackagedCodexBinary();
  const bridgeEnv = options.schedulerBridge
    ? options.schedulerBridge.getBridgeEnv(options.schedulerSessionId ?? "default")
    : {};
  const envOverrides = options.schedulerBridge && process.versions.electron
    ? { ...bridgeEnv, ELECTRON_RUN_AS_NODE: "1" }
    : bridgeEnv;
  const env = await (dependencies?.resolveEnvironment ?? resolveCodexProcessEnvironment)({
    codexHomeDir: options.codexHomeDir,
    prependPathEntries: packagedCodex?.extraPath ? [packagedCodex.extraPath] : undefined,
    appendPathEntries: process.platform === "win32" ? WINDOWS_POWERSHELL_PATHS : undefined,
    overrides: envOverrides
  });
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
  const codex = await resolvedCreateCodex({
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

function buildAppServerSandboxPolicy(options: {
  sandboxMode?: "danger-full-access" | "workspace-write";
  cwd: string;
  additionalDirectories?: string[];
}): Record<string, unknown> {
  if (options.sandboxMode === "workspace-write") {
    const writableRoots = Array.from(new Set([options.cwd, ...(options.additionalDirectories ?? [])]));
    return {
      type: "workspaceWrite",
      writableRoots,
      networkAccess: true
    };
  }

  return {
    type: "dangerFullAccess",
    networkAccess: true
  };
}


export async function createCodexThreadFromAppServer(options: {
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
  ephemeralThread?: boolean;
  serviceName?: string;
}): Promise<Thread> {
  const packagedCodex = resolvePackagedCodexBinary();
  const bridgeEnv = options.schedulerBridge
    ? options.schedulerBridge.getBridgeEnv(options.schedulerSessionId ?? options.threadId ?? "default")
    : {};
  const envOverrides = options.schedulerBridge && process.versions.electron
    ? { ...bridgeEnv, ELECTRON_RUN_AS_NODE: "1" }
    : bridgeEnv;
  const invocationEnv = await resolveCodexProcessEnvironment({
    codexHomeDir: options.codexHomeDir,
    prependPathEntries: packagedCodex?.extraPath ? [packagedCodex.extraPath] : undefined,
    appendPathEntries: process.platform === "win32" ? WINDOWS_POWERSHELL_PATHS : undefined,
    overrides: envOverrides
  });
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
  const sandboxPolicy = buildAppServerSandboxPolicy({
    sandboxMode: options.sandboxMode,
    cwd: options.cwd ?? process.cwd(),
    additionalDirectories: options.additionalDirectories
  });

  return {
    id: options.threadId ?? null,
    async runStreamed(input: string, runOptions?: { signal?: AbortSignal }) {
      const client = new CodexAppServerClient({
        codexHomeDir: options.codexHomeDir ?? path.join(options.homeDir ?? process.env.HOME ?? process.cwd(), ".codex"),
        codexCommand: packagedCodex?.command,
        invocationEnv
      });

      let activeThreadId = options.threadId ?? null;
      let activeTurnId: string | null = null;
      let startedEphemeralThread = false;
      let closed = false;
      const textByItemId = new Map<string, string>();
      const reasoningByItemId = new Map<string, string>();

      const closeClient = () => {
        if (closed) {
          return;
        }
        closed = true;
        client.close();
      };

      const abortHandler = () => {
        if (!activeThreadId || !activeTurnId) {
          closeClient();
          return;
        }
        void client.request("turn/interrupt", {
          threadId: activeThreadId,
          turnId: activeTurnId
        }, 5000).catch(() => {
          closeClient();
        });
      };

      if (runOptions?.signal) {
        if (runOptions.signal.aborted) {
          abortHandler();
        } else {
          runOptions.signal.addEventListener("abort", abortHandler, { once: true });
        }
      }

      await client.start();

      const threadParams: Record<string, unknown> = {
        model: options.model?.id,
        cwd: options.cwd ?? process.cwd(),
        approvalPolicy: "never",
        sandbox: options.sandboxMode === "workspace-write" ? "workspace-write" : "danger-full-access",
        serviceName: options.serviceName ?? "lilto",
        ...(mergeCodexConfig(mcpConfig, options.config) ? { config: mergeCodexConfig(mcpConfig, options.config) } : {})
      };

      if (activeThreadId) {
        await client.request("thread/resume", {
          threadId: activeThreadId,
          ...threadParams
        });
      } else {
        const result = await client.request<{ thread?: { id?: string | null } }>("thread/start", threadParams);
        activeThreadId = typeof result?.thread?.id === "string" ? result.thread.id : null;
        startedEphemeralThread = options.ephemeralThread === true && Boolean(activeThreadId);
      }

      if (!activeThreadId) {
        closeClient();
        throw new Error("codex app-server did not return a thread id");
      }

      const turnResult = await client.request<{ turn?: { id?: string | null } }>("turn/start", {
        threadId: activeThreadId,
        input: [{ type: "text", text: input }],
        cwd: options.cwd ?? process.cwd(),
        approvalPolicy: "never",
        sandboxPolicy,
        ...(options.model?.id ? { model: options.model.id } : {}),
        ...(mergeCodexConfig(mcpConfig, options.config) ? { config: mergeCodexConfig(mcpConfig, options.config) } : {})
      });
      activeTurnId = typeof turnResult?.turn?.id === "string" ? turnResult.turn.id : null;

      const events = (async function* (): AsyncGenerator<ThreadEvent> {
        try {
          for (;;) {
            const notification = await client.nextNotification();
            const params = notification.params && typeof notification.params === "object"
              ? notification.params as Record<string, unknown>
              : {};

            if (notification.method === "thread/started") {
              const threadId = params.thread && typeof params.thread === "object" && typeof (params.thread as { id?: unknown }).id === "string"
                ? (params.thread as { id: string }).id
                : activeThreadId;
              yield { type: "thread.started", thread_id: threadId };
              continue;
            }

            if (notification.method === "turn/completed") {
              const turn = params.turn && typeof params.turn === "object" ? params.turn as Record<string, unknown> : {};
              const status = typeof turn.status === "string" ? turn.status : "failed";
              if (status === "completed") {
                return;
              }
              const errorMessage = turn.error && typeof turn.error === "object" && typeof (turn.error as { message?: unknown }).message === "string"
                ? (turn.error as { message: string }).message
                : status === "interrupted"
                  ? "interrupted"
                  : `turn ${status}`;
              if (status === "failed") {
                yield { type: "turn.failed", error: { message: errorMessage } };
              } else {
                yield { type: "error", message: errorMessage };
              }
              return;
            }

            if (notification.method === "item/agentMessage/delta") {
              const itemId = typeof params.itemId === "string" ? params.itemId : null;
              const delta = typeof params.delta === "string" ? params.delta : "";
              if (itemId) {
                const nextText = `${textByItemId.get(itemId) ?? ""}${delta}`;
                textByItemId.set(itemId, nextText);
                yield {
                  type: "item.updated",
                  item: { id: itemId, type: "agent_message", text: nextText }
                };
              }
              continue;
            }

            if (notification.method === "item/reasoning/summaryTextDelta") {
              const itemId = typeof params.itemId === "string" ? params.itemId : null;
              const delta = typeof params.delta === "string" ? params.delta : "";
              if (itemId) {
                const nextText = `${reasoningByItemId.get(itemId) ?? ""}${delta}`;
                reasoningByItemId.set(itemId, nextText);
                yield {
                  type: "item.updated",
                  item: { id: itemId, type: "reasoning", text: nextText }
                };
              }
              continue;
            }

            if (notification.method === "item/started" || notification.method === "item/completed") {
              const item = translateAppServerItem(params.item);
              if (!item) {
                continue;
              }
              if (item.type === "agent_message") {
                textByItemId.set(item.id, (item as { text?: string }).text ?? "");
              }
              if (item.type === "reasoning") {
                reasoningByItemId.set(item.id, (item as { text?: string }).text ?? "");
              }
              yield {
                type: notification.method === "item/started" ? "item.started" : "item.completed",
                item
              };
            }
          }
        } finally {
          if (runOptions?.signal) {
            runOptions.signal.removeEventListener("abort", abortHandler);
          }
          if (startedEphemeralThread && activeThreadId) {
            await client.request("thread/archive", {
              threadId: activeThreadId
            }, 5000).catch(() => {});
          }
          closeClient();
        }
      })();

      return { events };
    }
  };
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
    ephemeralThread?: boolean;
    serviceName?: string;
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
    createSession = createCodexThreadFromAppServer,
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
      ephemeralThread?: boolean;
      serviceName?: string;
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
    freshContext?: boolean;
    ephemeralThread?: boolean;
    serviceName?: string;
    threadOptions: SessionThreadOptions;
  }): Promise<CodexSession> {
    const cwd = options.cwd ?? process.cwd();
    const threadId = options.freshContext
      ? undefined
      : (options.conversationId ? this.conversationThreads.get(options.conversationId) : undefined)
        ?? options.backendSessionId;
    const signature = JSON.stringify({
      conversationId: options.conversationId ?? "default",
      apiKey: options.apiKey ?? "",
      modelId: options.model?.id ?? "",
      baseUrl: options.model?.baseUrl ?? "",
      sandboxMode: options.threadOptions.sandboxMode,
      config: options.threadOptions.config ?? null,
      cwd,
      freshContext: options.freshContext === true
    });
    if (!options.freshContext) {
      const existing = this.sessionCache.get(signature);
      if (existing) {
        return existing;
      }
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
      config: options.threadOptions.config,
      ephemeralThread: options.ephemeralThread,
      serviceName: options.serviceName
    });
    const session = { signature, thread };
    if (!options.freshContext) {
      this.sessionCache.set(signature, session);
    }
    return session;
  }

  private async runSessionPrompt(
    text: string,
    options: {
      apiKey: string | null;
      model?: RuntimeModel;
      cwd?: string;
      conversationId?: string;
      backendSessionId?: string;
      freshContext?: boolean;
      ephemeralThread?: boolean;
      serviceName?: string;
    },
    providerSettings: ProviderSettings,
    hooks?: {
      requestId: string;
      conversationId?: string;
      freshContext?: boolean;
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
        const next = processThreadEvent(event, state, hooks, this.logger, this.conversationThreads);
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
      freshContext?: boolean;
      ephemeralThread?: boolean;
      serviceName?: string;
      onLoopEvent?: (event: AgentLoopEvent) => void;
      mode?: "default" | "heartbeat";
    }
  ): Promise<AgentResult> {
    try {
      const usesAuxiliaryThread = hooks?.freshContext === true
        && (hooks.mode === "heartbeat" || text.startsWith(SCHEDULER_FOLLOW_UP_PROMPT_PREFIX));

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
              message: "API key / Base URL を設定し、モデル一覧からモデルを選択してください。",
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
          {
            apiKey,
            model,
            conversationId: hooks?.conversationId,
            backendSessionId: hooks?.backendSessionId,
            freshContext: hooks?.freshContext,
            ephemeralThread: hooks?.ephemeralThread ?? usesAuxiliaryThread,
            serviceName: hooks?.serviceName ?? (usesAuxiliaryThread ? AUXILIARY_THREAD_SERVICE_NAME : undefined),
            ...runOptionsBase
          },
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

      if (!providerSettings.oauthModelId.trim()) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_CONFIG_REQUIRED",
            message: "モデル一覧を取得して、利用するモデルを選択してください。",
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
          freshContext: hooks?.freshContext,
          ephemeralThread: hooks?.ephemeralThread ?? usesAuxiliaryThread,
          serviceName: hooks?.serviceName ?? (usesAuxiliaryThread ? AUXILIARY_THREAD_SERVICE_NAME : undefined),
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

