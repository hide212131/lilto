import { buildPromptInput, type PromptImage } from "../shared/prompt-images";
import http from "node:http";
import path from "node:path";
import { createLogger, type Logger } from "./logger";
import { buildCustomModel, buildOauthModel, buildSessionThreadOptions, isLocalOllamaUrl, mergeCodexConfig, withBrowserMcpConfig, BROWSER_INSTRUCTION_CONTEXT_KEY, augmentPromptForScheduler, SCHEDULER_FOLLOW_UP_PROMPT_PREFIX, AUXILIARY_THREAD_SERVICE_NAME } from "./agent-sdk-config";
import { standardizeExecutionError } from "./agent-sdk-errors";
import { processThreadEvent, translateAppServerItem } from "./agent-sdk-event-processing";
import type { AgentResult, BrowserRunOptions, CodexConfig, RunStreamedOptions, RuntimeModel, SessionThreadOptions, Thread, ThreadEvent, ThreadItem } from "./agent-sdk-types";
import type { BrowserRunSupport } from "./browser-run-support";
import { BrowserInstructionStateStore, browserInstructionNamespace, type BrowserInstructionAttempt } from "./browser-instruction-state-store";
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

function getSessionProxyEnvironment(settings: ProviderSettings): Record<string, string> {
  const source = settings.networkProxy.useProxy
    ? getProxyEnvironmentValues()
    : { httpProxy: "", httpsProxy: "", noProxy: "" };
  return {
    HTTP_PROXY: source.httpProxy, http_proxy: source.httpProxy,
    HTTPS_PROXY: source.httpsProxy, https_proxy: source.httpsProxy,
    NO_PROXY: source.noProxy, no_proxy: source.noProxy
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
  ephemeralThread?: boolean;
  serviceName?: string;
  environment?: Record<string, string>;
  instructionStore?: BrowserInstructionStateStore;
}, dependencies?: {
  /** Test seam: the App Server adapter that browser-managed runs are delegated to. */
  createAppServerThread?: typeof createCodexThreadFromAppServer;
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
    overrides: { ...envOverrides, ...options.environment }
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
  const sdkThread = options.threadId ? codex.resumeThread(options.threadId, threadOptions) : codex.startThread(threadOptions);
  // The SDK cannot carry lilto's browser state (it has no additionalContext/browserRun support), so runs that are
  // browser-managed go through the same App Server adapter as the default factory. Other runs stay on the SDK.
  let managed = null as Thread | null;
  let managedActive = false;
  return {
    get id() { return managed?.id ?? sdkThread.id; },
    async steer(input, images) {
      const target = managedActive ? managed : sdkThread;
      if (!target?.steer) throw new Error("追加指示を受け付ける実行中のターンがありません。再送信してください。");
      await target.steer(input, images);
    },
    async runStreamed(input, runOptions) {
      if (!runOptions?.browserRun) {
        managedActive = false;
        return sdkThread.runStreamed(input, runOptions);
      }
      const appServerThread = managed ??= await (dependencies?.createAppServerThread ?? createCodexThreadFromAppServer)({
        ...options,
        threadId: sdkThread.id ?? options.threadId
      });
      managedActive = true;
      return appServerThread.runStreamed(input, runOptions);
    }
  };
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


/** Shown when a turn was stopped because Codex compacted the history (which drops lilto's browser state). */
export const BROWSER_COMPACTION_STOP_MESSAGE =
  "会話履歴の自動圧縮が発生したため、ブラウザ指示を再適用するためにこのターンを停止しました。もう一度送信すると、次のターンで指示が再送されて続行できます。";

type CompactionItem = { threadId: string; turnId: string | null };

function readCompactionItem(method: string, params: unknown): { phase: "started" | "completed"; item: CompactionItem } | null {
  if (method !== "item/started" && method !== "item/completed") return null;
  if (!params || typeof params !== "object") return null;
  const p = params as { item?: { type?: unknown }; threadId?: unknown; turnId?: unknown };
  if (p.item?.type !== "contextCompaction" || typeof p.threadId !== "string") return null;
  return { phase: method === "item/started" ? "started" : "completed", item: { threadId: p.threadId, turnId: typeof p.turnId === "string" ? p.turnId : null } };
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
  environment?: Record<string, string>;
  /** Required for runs that carry a browserRun context; owns the per-thread record of the announced state. */
  instructionStore?: BrowserInstructionStateStore;
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
    overrides: { ...envOverrides, ...options.environment }
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
  const codexHomeDir = options.codexHomeDir ?? path.join(options.homeDir ?? process.env.HOME ?? process.cwd(), ".codex");
  const instructionNamespace = browserInstructionNamespace(codexHomeDir);

  let steerActiveTurn: ((input: string, images?: PromptImage[]) => Promise<void>) | null = null;
  // The backend thread this object represents. Kept across runs so a reused object resumes instead of starting anew.
  let currentThreadId = options.threadId ?? null;
  return {
    get id() { return currentThreadId; },
    async steer(input: string, images?: PromptImage[]) {
      if (!steerActiveTurn) throw new Error("追加指示を受け付ける実行中のターンがありません。再送信してください。");
      await steerActiveTurn(input, images);
    },
    async runStreamed(input: string, runOptions?: RunStreamedOptions) {
      const client = new CodexAppServerClient({
        codexHomeDir,
        codexCommand: packagedCodex?.command,
        invocationEnv
      });

      const browserRun = runOptions?.browserRun;
      const store = options.instructionStore;
      if (browserRun && !store) throw new Error("browser instruction store is not configured");

      let activeThreadId = currentThreadId;
      let activeTurnId: string | null = null;
      let startedEphemeralThread = false;
      let closed = false;
      let attempt: BrowserInstructionAttempt | null = null;
      let attemptSettled = false;
      let releaseThread: (() => void) | null = null;
      let compactionSeen = false;
      let interruptedForCompaction = false;
      let stopListening: () => void = () => {};
      const textByItemId = new Map<string, string>();
      const reasoningByItemId = new Map<string, string>();

      const closeClient = () => {
        if (closed) {
          return;
        }
        closed = true;
        stopListening();
        client.close();
      };

      /** Anything that is not a normal completion: no record of this thread may be trusted any more. */
      const settleUnknown = async () => {
        if (!attempt || attemptSettled) return;
        attemptSettled = true;
        await store!.markUnknown(attempt);
      };
      const releaseAll = () => {
        releaseThread?.();
        releaseThread = null;
      };

      const interruptTurn = (turnId: string | null) => {
        const threadId = activeThreadId;
        const target = turnId ?? activeTurnId;
        if (!threadId || !target) return;
        void client.request("turn/interrupt", { threadId, turnId: target }, 5000).catch(() => { closeClient(); });
      };

      const abortHandler = () => {
        if (!activeThreadId || !activeTurnId) {
          closeClient();
          return;
        }
        interruptTurn(activeTurnId);
      };

      if (runOptions?.signal) {
        if (runOptions.signal.aborted) {
          abortHandler();
        } else {
          runOptions.signal.addEventListener("abort", abortHandler, { once: true });
        }
      }

      let turnResult: { turn?: { id?: string | null } };
      let runConfig: CodexConfig | undefined;
      try {
        await client.start();

        // Compaction drops lilto's browser state from the model input. React the moment the notification is parsed
        // (not when the consumer pulls it) so the turn stops before it continues without the state.
        if (browserRun && store) {
          stopListening = client.onNotification((message) => {
            const compaction = readCompactionItem(message.method, message.params);
            if (!compaction || compaction.item.threadId !== activeThreadId) return;
            compactionSeen = true;
            const streak = store.getCompactionInterrupts(instructionNamespace, compaction.item.threadId);
            if (interruptedForCompaction) return;
            // Stopping at the START discards that compaction; if the thread is still oversized the next turn would
            // compact (and stop) again forever. After one such stop, wait until the compaction is committed.
            if (compaction.phase === "started" && streak === 0) {
              interruptedForCompaction = true;
              store.setCompactionInterrupts(instructionNamespace, compaction.item.threadId, 1);
              interruptTurn(compaction.item.turnId);
            } else if (compaction.phase === "completed") {
              interruptedForCompaction = true;
              store.setCompactionInterrupts(instructionNamespace, compaction.item.threadId, 0);
              interruptTurn(compaction.item.turnId);
            }
          });
        }

        // The browser MCP server (and its token) exists only for this run's client.
        runConfig = withBrowserMcpConfig(mergeCodexConfig(mcpConfig, options.config), browserRun?.launch);
        // Browser instructions travel as turn/start additionalContext only; thread/start|resume developerInstructions are never used.
        const threadParams: Record<string, unknown> = {
          model: options.model?.id,
          cwd: options.cwd ?? process.cwd(),
          approvalPolicy: "never",
          sandbox: options.sandboxMode === "workspace-write" ? "workspace-write" : "danger-full-access",
          serviceName: options.serviceName ?? "lilto",
          ...(runConfig ? { config: runConfig } : {})
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
          if (activeThreadId && !startedEphemeralThread) currentThreadId = activeThreadId;
        }

        if (!activeThreadId) {
          throw new Error("codex app-server did not return a thread id");
        }

        if (browserRun && store) {
          releaseThread = store.tryAcquireThread(instructionNamespace, activeThreadId);
          if (!releaseThread) throw new Error("このスレッドは別の実行で使用中です。完了してから再送信してください。");
          // Persisted before the turn is issued; a failure here means no turn at all.
          attempt = await store.begin(instructionNamespace, activeThreadId, browserRun.update.state);
        }

        turnResult = await client.request<{ turn?: { id?: string | null } }>("turn/start", {
          threadId: activeThreadId,
          input: buildPromptInput(input, runOptions?.images),
          cwd: options.cwd ?? process.cwd(),
          approvalPolicy: "never",
          sandboxPolicy,
          ...(options.model?.id ? { model: options.model.id } : {}),
          ...(runConfig ? { config: runConfig } : {}),
          ...(attempt?.sendUpdate && browserRun
            ? { additionalContext: { [BROWSER_INSTRUCTION_CONTEXT_KEY]: { kind: "application", value: browserRun.update.text } } }
            : {})
        });
      } catch (error) {
        // The update may have reached the model even though the call failed: never fall back to "already sent".
        await settleUnknown();
        releaseAll();
        runOptions?.signal?.removeEventListener("abort", abortHandler);
        closeClient();
        throw error;
      }
      activeTurnId = typeof turnResult?.turn?.id === "string" ? turnResult.turn.id : null;
      const steer = async (text: string, images?: PromptImage[]) => {
        if (closed || runOptions?.signal?.aborted || !activeTurnId) {
          throw new Error("ターンが終了したため追加指示を送信できません。再送信してください。");
        }
        await client.request("turn/steer", {
          threadId: activeThreadId,
          expectedTurnId: activeTurnId,
          input: buildPromptInput(text, images)
        });
      };
      steerActiveTurn = steer;

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
              if (steerActiveTurn === steer) steerActiveTurn = null;
              const turn = params.turn && typeof params.turn === "object" ? params.turn as Record<string, unknown> : {};
              const status = typeof turn.status === "string" ? turn.status : "failed";
              if (attempt && store) {
                if (!compactionSeen) store.setCompactionInterrupts(instructionNamespace, activeThreadId!, 0);
                if (status === "completed" && !compactionSeen && !runOptions?.signal?.aborted) {
                  attemptSettled = true;
                  await store.confirm(attempt);
                } else {
                  await settleUnknown();
                }
              }
              if (interruptedForCompaction && status === "interrupted") {
                yield { type: "turn.failed", error: { message: BROWSER_COMPACTION_STOP_MESSAGE } };
                return;
              }
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
          if (steerActiveTurn === steer) steerActiveTurn = null;
          if (runOptions?.signal) {
            runOptions.signal.removeEventListener("abort", abortHandler);
          }
          // Connection loss or an abandoned consumer ends here without a settled attempt.
          await settleUnknown();
          releaseAll();
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
    environment?: Record<string, string>;
    instructionStore?: BrowserInstructionStateStore;
  }) => Promise<Thread>;
  private readonly instructionStore?: BrowserInstructionStateStore;
  private readonly authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
  private readonly logger: Logger;
  private readonly workspaceDir?: string;
  private readonly codexHomeDir?: string;
  private readonly homeDir?: string;
  private readonly schedulerBridge?: SchedulerBridgeServer;
  private readonly browserSupport?: BrowserRunSupport;
  private readonly platform: NodeJS.Platform;
  private readonly sessionCache = new Map<string, CodexSession>();
  private readonly conversationThreads = new Map<string, string>();
  private readonly runningRequests = new Map<symbol, { conversationId?: string; controller: AbortController }>();
  private readonly activeConversationRuns = new Map<string, {
    ready: Promise<Thread | null>;
    resolve: (thread: Thread | null) => void;
    signal: AbortSignal;
  }>();

  async steerPrompt(text: string, conversationId: string, images?: PromptImage[]): Promise<AgentResult> {
    const run = this.activeConversationRuns.get(conversationId);
    if (!run) {
      return { ok: false, error: { code: "NO_ACTIVE_TURN", message: "実行が終了したか、追加指示を受け付けられません。再送信してください。", details: null, retryable: true } };
    }
    try {
      const thread = await run.ready;
      if (!thread?.steer || run.signal.aborted || this.activeConversationRuns.get(conversationId) !== run) {
        return { ok: false, error: { code: "NO_ACTIVE_TURN", message: "追加指示を送信できませんでした。再送信してください。", details: null, retryable: true } };
      }
      await thread.steer(text, images);
      return { ok: true, text: "" };
    } catch (error) {
      return { ok: false, error: { code: "STEER_FAILED", message: error instanceof Error ? error.message : String(error), details: null, retryable: true } };
    }
  }

  get isBusy(): boolean {
    return this.runningRequests.size > 0;
  }

  /** True when a foreground run belongs to this conversation (renderer ID or backend thread ID). */
  isConversationRunning(conversationId: string): boolean {
    return [...this.runningRequests.values()].some((run) => run.conversationId !== undefined
      && (run.conversationId === conversationId || this.conversationThreads.get(run.conversationId) === conversationId));
  }

  /** Drops cached threads for an archived/deleted conversation so they are never reused. */
  forgetConversation(conversationId: string): void {
    const ids = new Set([conversationId]);
    for (const [key, threadId] of [...this.conversationThreads]) {
      if (key === conversationId || threadId === conversationId) {
        ids.add(key);
        this.conversationThreads.delete(key);
      }
    }
    for (const signature of [...this.sessionCache.keys()]) {
      let cachedConversationId: unknown;
      try { cachedConversationId = (JSON.parse(signature) as { conversationId?: unknown }).conversationId; } catch { continue; }
      if (typeof cachedConversationId === "string" && ids.has(cachedConversationId)) this.sessionCache.delete(signature);
    }
  }

  constructor({
    createSession = createCodexThreadFromAppServer,
    authService,
    workspaceDir,
    codexHomeDir,
    homeDir,
    schedulerBridge,
    browserSupport,
    instructionStore,
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
      environment?: Record<string, string>;
      instructionStore?: BrowserInstructionStateStore;
    }) => Promise<Thread>;
    instructionStore?: BrowserInstructionStateStore;
    authService: Pick<ClaudeAuthService, "getState" | "getApiKey">;
    workspaceDir?: string;
    codexHomeDir?: string;
    homeDir?: string;
    availableSkills?: Array<{ name: string }>;
    schedulerBridge?: SchedulerBridgeServer;
    browserSupport?: BrowserRunSupport;
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
    this.browserSupport = browserSupport;
    this.instructionStore = instructionStore;
    this.platform = platform;
  }

  /**
   * Stop every running turn and wait (bounded) for the App Server clients to wind down.
   * Used when the browser setting flips so no stale tool/skill configuration survives.
   */
  async stopAllRuns(timeoutMs = 8000): Promise<void> {
    this.browserSupport?.revokeAll();
    for (const run of this.runningRequests.values()) run.controller.abort();
    this.invalidateSession();
    const deadline = Date.now() + timeoutMs;
    while (this.runningRequests.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  abort(conversationId: string): void {
    for (const run of this.runningRequests.values()) {
      if (run.conversationId === conversationId) run.controller.abort();
    }
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
    environment?: Record<string, string>;
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
      freshContext: options.freshContext === true,
      environment: options.environment
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
      serviceName: options.serviceName,
      environment: options.environment,
      instructionStore: this.instructionStore
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
    abortController: AbortController,
    hooks?: {
      images?: PromptImage[];
      requestId: string;
      conversationId?: string;
      freshContext?: boolean;
      onLoopEvent?: (event: AgentLoopEvent) => void;
      mode?: "default" | "heartbeat";
    }
  ): Promise<AgentResult> {
    let resolveReady!: (thread: Thread | null) => void;
    const ready = new Promise<Thread | null>((resolve) => { resolveReady = resolve; });
    const activeRun = { ready, resolve: resolveReady, signal: abortController.signal };
    const cancelReady = () => activeRun.resolve(null);
    abortController.signal.addEventListener("abort", cancelReady, { once: true });
    if (hooks?.conversationId && hooks.mode !== "heartbeat" && !hooks.freshContext) {
      this.activeConversationRuns.set(hooks.conversationId, activeRun);
    }
    let browserRunEnd = null as (() => void) | null; // assigned from a closure below
    try {
      // Classify by the effective options (after auxiliary-thread resolution), not by what hooks happened to omit.
      const browserManaged = Boolean(this.browserSupport && hooks?.conversationId && hooks.mode !== "heartbeat" && !hooks.freshContext
        && options.ephemeralThread !== true && options.serviceName !== AUXILIARY_THREAD_SERVICE_NAME);
      let browserRun: BrowserRunOptions | undefined;
      let browserRevision = 0;
      const resolveBrowserRun = (): BrowserRunOptions => {
        const support = this.browserSupport!;
        browserRevision = support.policyRevision();
        const decision = support.resolve({ conversationId: hooks!.conversationId!, requestId: hooks!.requestId });
        if (decision.kind === "unavailable") {
          // ON (or mid-change) but no capability: never fall back to OFF, never start a turn, never touch the record.
          throw new Error(decision.reason === "settings-changing"
            ? "ブラウザ設定を適用中のため、実行を開始できませんでした。少し待ってから再送信してください。"
            : "埋め込みブラウザ連携が有効ですが、利用できる状態ではありません。連携の起動に失敗した可能性があります。設定を確認して再送信してください。");
        }
        browserRunEnd = decision.kind === "on" ? decision.end : null;
        return { update: decision.update, ...(decision.kind === "on" ? { launch: decision.launch } : {}) };
      };
      if (browserManaged) browserRun = resolveBrowserRun();
      const session = await this.ensureSession({
        ...options,
        environment: getSessionProxyEnvironment(providerSettings),
        threadOptions: buildSessionThreadOptions(providerSettings, this.platform)
      });
      if (abortController.signal.aborted) throw new Error("中断しました");
      if (session.thread.id && hooks?.onLoopEvent) {
        hooks.onLoopEvent({
          type: "session_bound",
          requestId: hooks.requestId,
          conversationId: hooks.conversationId,
          agentSessionId: session.thread.id
        });
      }

      const prompt = hooks?.mode === "heartbeat" ? text : augmentPromptForScheduler(text);
      // A setting that changed while this run was preparing invalidates the snapshot: prepare again.
      if (browserRun && this.browserSupport!.policyRevision() !== browserRevision) {
        browserRunEnd?.();
        browserRunEnd = null;
        browserRun = resolveBrowserRun();
        if (this.browserSupport!.policyRevision() !== browserRevision) throw new Error("ブラウザ設定が変更されたため、実行を開始できませんでした。再送信してください。");
      }
      const streamed = await session.thread.runStreamed(prompt, {
        signal: abortController.signal,
        images: hooks?.images,
        ...(browserRun ? { browserRun } : {})
      });
      activeRun.resolve(session.thread);
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

      if (abortController.signal.aborted) throw new Error("中断しました");
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
      browserRunEnd?.();
      abortController.signal.removeEventListener("abort", cancelReady);
      activeRun.resolve(null);
      if (hooks?.conversationId && this.activeConversationRuns.get(hooks.conversationId) === activeRun) {
        this.activeConversationRuns.delete(hooks.conversationId);
      }
    }
  }

  async submitPrompt(
    text: string,
    providerSettings: ProviderSettings,
    hooks?: {
      images?: PromptImage[];
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
    // Reserve a foreground conversation before any asynchronous preparation.
    const conversationId = hooks?.mode !== "heartbeat" && !hooks?.freshContext ? hooks?.conversationId : undefined;
    if (conversationId && [...this.runningRequests.values()].some((run) => run.conversationId === conversationId)) {
      return { ok: false, error: { code: "CONVERSATION_BUSY", message: "この会話は実行中です。追加指示として送信してください。", details: null, retryable: true } };
    }
    const runKey = Symbol();
    const controller = new AbortController();
    this.runningRequests.set(runKey, { conversationId, controller });
    try {
      const usesAuxiliaryThread = hooks?.freshContext === true
        && (hooks.mode === "heartbeat" || text.startsWith(SCHEDULER_FOLLOW_UP_PROMPT_PREFIX));

      if (process.env.LILTO_E2E_MOCK === "1") {
        await runProxyPrecheckIfEnabled(providerSettings);
        if (controller.signal.aborted) return { ok: false, error: { code: "ABORTED", message: "中断しました", details: null, retryable: false } };
        const additions: string[] = [];
        const mockThread: Thread = {
          id: hooks?.conversationId ?? "e2e-mock-session",
          async steer(input) { additions.push(input); },
          async runStreamed() { return { events: (async function* () {})() }; }
        };
        const activeRun = { ready: Promise.resolve(mockThread), resolve: () => {}, signal: controller.signal };
        const conversationId = hooks?.mode !== "heartbeat" && !hooks?.freshContext ? hooks?.conversationId : undefined;
        if (conversationId) this.activeConversationRuns.set(conversationId, activeRun);
        try {
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
          await new Promise<void>((resolve) => {
            const timer = setTimeout(finish, Number(process.env.LILTO_E2E_TURN_DELAY_MS) || 0);
            function finish() {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", finish);
              resolve();
            }
            controller.signal.addEventListener("abort", finish, { once: true });
          });
          if (controller.signal.aborted) {
            return { ok: false, error: { code: "ABORTED", message: "中断しました", details: null, retryable: false } };
          }
          if (text.startsWith("[E2E_MOCK_FAIL]")) {
            return { ok: false, error: { code: "E2E_MOCK_FAILURE", message: "会話単位の失敗検証", details: null, retryable: true } };
          }
          const suffix = additions.length ? ` 追加指示: ${additions.join(" / ")}` : "";
          return { ok: true, text: `[E2E_MOCK_FINAL] 要求「${text}」を処理し、複数コマンドを実行して回答しました。${suffix}` };
        } finally {
          if (conversationId && this.activeConversationRuns.get(conversationId) === activeRun) {
            this.activeConversationRuns.delete(conversationId);
          }
        }
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
          controller,
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
        controller,
        hooks
      );
    } catch (error) {
      const normalized = standardizeExecutionError(error);
      this.logger.error("agent_prompt_failed", normalized);
      return { ok: false, error: normalized };
    } finally {
      this.runningRequests.delete(runKey);
    }
  }
}

