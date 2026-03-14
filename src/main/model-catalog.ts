import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { createLogger, type Logger } from "./logger";
import type { CustomProviderSettings, NetworkProxySettings, OAuthProviderId } from "../shared/provider-settings";

export type ListedModel = {
  id: string;
  displayName: string;
};

export type ModelCatalogResult =
  | { ok: true; models: ListedModel[] }
  | { ok: false; error: { code: string; message: string } };

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const LOCAL_OLLAMA_URLS = new Set(["http://127.0.0.1:11434", "http://localhost:11434"]);

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_BASE_URL;
  }
  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const host = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    if (LOCAL_OLLAMA_URLS.has(host) && (normalizedPath === "" || normalizedPath === "/")) {
      parsed.pathname = "/v1";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
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

function withScopedProxyEnvironment(settings: NetworkProxySettings): () => void {
  const source = settings.useProxy
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

function isLocalOllamaUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "11434";
  } catch {
    return false;
  }
}

function toListedModels(models: Array<{ id: string; displayName?: string }>): ListedModel[] {
  return models
    .map((model) => ({ id: model.id, displayName: model.displayName?.trim() || model.id }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function waitForJsonRpcResponse(
  child: ChildProcessWithoutNullStreams,
  requestId: number,
  timeoutMs: number
): Promise<any> {
  return await new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const stderrLines: string[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for JSON-RPC response ${requestId}. stderr=${stderrLines.slice(-10).join("\n")}`));
    }, timeoutMs);

    const onStderr = (chunk: Buffer | string) => {
      stderrLines.push(String(chunk).trim());
      if (stderrLines.length > 20) {
        stderrLines.shift();
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      rl.close();
      child.stderr.off("data", onStderr);
    };

    child.stderr.on("data", onStderr);
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line);
        if (message.id === requestId) {
          cleanup();
          if (message.error) {
            reject(new Error(message.error.message || JSON.stringify(message.error)));
            return;
          }
          resolve(message.result);
        }
      } catch {
        // ignore non-json lines from stdout
      }
    });
    child.once("exit", (code) => {
      cleanup();
      reject(new Error(`codex app-server exited before response ${requestId} (code=${code ?? "unknown"})`));
    });
  });
}

async function requestAppServer(
  child: ChildProcessWithoutNullStreams,
  requestId: number,
  method: string,
  params: Record<string, unknown>
): Promise<any> {
  child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
  return await waitForJsonRpcResponse(child, requestId, 15000);
}

export class ModelCatalogService {
  constructor(
    private readonly options: {
      codexHomeDir: string;
      codexCommand?: string;
      logger?: Logger;
      fetchImpl?: typeof fetch;
      spawnImpl?: typeof spawn;
    }
  ) {}

  private get logger(): Logger {
    return this.options.logger ?? createLogger("models");
  }

  async listOauthModels(_provider: OAuthProviderId, networkProxy: NetworkProxySettings): Promise<ModelCatalogResult> {
    const restoreProxyEnv = withScopedProxyEnvironment(networkProxy);
    const child = (this.options.spawnImpl ?? spawn)(this.options.codexCommand ?? "codex", ["app-server", "--listen", "stdio://"], {
      env: {
        ...process.env,
        CODEX_HOME: this.options.codexHomeDir
      },
      stdio: ["pipe", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams;

    try {
      await requestAppServer(child, 1, "initialize", {
        clientInfo: {
          name: "lilto",
          title: "Lilt-o",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      });
      const response = await requestAppServer(child, 2, "model/list", { includeHidden: false });
      const data = Array.isArray(response?.data) ? response.data : [];
      return { ok: true, models: toListedModels(data) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("oauth_models_list_failed", { message });
      return {
        ok: false,
        error: {
          code: "OAUTH_MODELS_FETCH_FAILED",
          message
        }
      };
    } finally {
      restoreProxyEnv();
      child.kill();
    }
  }

  async listCustomProviderModels(
    provider: Pick<CustomProviderSettings, "baseUrl" | "apiKey">,
    networkProxy: NetworkProxySettings
  ): Promise<ModelCatalogResult> {
    const restoreProxyEnv = withScopedProxyEnvironment(networkProxy);
    try {
      const baseUrl = normalizeBaseUrl(provider.baseUrl);
      const headers: Record<string, string> = {};
      const apiKey = provider.apiKey.trim();
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      } else if (!isLocalOllamaUrl(baseUrl)) {
        return {
          ok: false,
          error: {
            code: "API_KEY_REQUIRED",
            message: "API Key を入力してからモデル一覧を取得してください。"
          }
        };
      }

      const response = await (this.options.fetchImpl ?? fetch)(`${baseUrl}/models`, {
        headers
      });
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "CUSTOM_MODELS_FETCH_FAILED",
            message: `モデル一覧の取得に失敗しました: ${response.status} ${response.statusText}`
          }
        };
      }
      const body = await response.json() as { data?: Array<{ id?: string }> };
      const models = Array.isArray(body.data)
        ? body.data
          .filter((item): item is { id: string } => typeof item?.id === "string" && item.id.trim().length > 0)
          .map((item) => ({ id: item.id, displayName: item.id }))
        : [];
      return { ok: true, models: toListedModels(models) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("custom_models_list_failed", { message });
      return {
        ok: false,
        error: {
          code: "CUSTOM_MODELS_FETCH_FAILED",
          message
        }
      };
    } finally {
      restoreProxyEnv();
    }
  }
}
