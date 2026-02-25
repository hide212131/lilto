import fs from "node:fs";
import path from "node:path";
import { createLogger, type Logger } from "./logger";
import {
  DEFAULT_NETWORK_PROXY_SETTINGS,
  type ActiveProvider,
  type CustomProviderSettings,
  type NetworkProxySettings,
  type ProviderSettings
} from "../shared/provider-settings";

export type {
  ActiveProvider,
  CustomProviderSettings,
  NetworkProxySettings,
  ProviderSettings
} from "../shared/provider-settings";

export type ProviderSettingsSaveResult =
  | { ok: true; state: ProviderSettings }
  | { ok: false; error: { code: "INVALID_PROVIDER_SETTINGS"; message: string } };

const DEFAULT_MODEL_ID = "qwen2.5:0.5b";

const DEFAULT_SETTINGS: ProviderSettings = {
  activeProvider: "claude",
  customProvider: {
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    modelId: DEFAULT_MODEL_ID
  },
  networkProxy: { ...DEFAULT_NETWORK_PROXY_SETTINGS },
  updatedAt: Date.now()
};

function toTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeActiveProvider(value: unknown): ActiveProvider {
  return value === "custom-openai-completions" ? "custom-openai-completions" : "claude";
}

function normalizeSettings(value: unknown): ProviderSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const custom =
    record.customProvider && typeof record.customProvider === "object"
      ? (record.customProvider as Record<string, unknown>)
      : {};
  const proxy =
    record.networkProxy && typeof record.networkProxy === "object"
      ? (record.networkProxy as Record<string, unknown>)
      : {};

  return {
    activeProvider: normalizeActiveProvider(record.activeProvider),
    customProvider: {
      name: toTrimmedString(custom.name),
      baseUrl: toTrimmedString(custom.baseUrl),
      apiKey: typeof custom.apiKey === "string" ? custom.apiKey : "",
      modelId: toTrimmedString(custom.modelId, DEFAULT_MODEL_ID) || DEFAULT_MODEL_ID
    },
    networkProxy: {
      httpProxy: toTrimmedString(proxy.httpProxy),
      httpsProxy: toTrimmedString(proxy.httpsProxy),
      noProxy: toTrimmedString(proxy.noProxy)
    },
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now()
  };
}

function isValidProxyUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidSavePayload(payload: unknown): payload is {
  activeProvider: ActiveProvider;
  customProvider: CustomProviderSettings;
  networkProxy?: NetworkProxySettings;
} {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  if (record.activeProvider !== "claude" && record.activeProvider !== "custom-openai-completions") {
    return false;
  }
  if (!record.customProvider || typeof record.customProvider !== "object") {
    return false;
  }

  const custom = record.customProvider as Record<string, unknown>;
  const customValid =
    typeof custom.name === "string" &&
    typeof custom.baseUrl === "string" &&
    typeof custom.apiKey === "string" &&
    typeof custom.modelId === "string";
  if (!customValid) return false;

  if (record.networkProxy === undefined) return true;
  if (!record.networkProxy || typeof record.networkProxy !== "object") return false;
  const proxy = record.networkProxy as Record<string, unknown>;
  return (
    typeof proxy.httpProxy === "string" &&
    typeof proxy.httpsProxy === "string" &&
    typeof proxy.noProxy === "string"
  );
}

export class ProviderSettingsService {
  private readonly logger: Logger;
  private readonly storagePath: string;
  private state: ProviderSettings = { ...DEFAULT_SETTINGS };

  constructor({
    logger = createLogger("providers"),
    storagePath = path.join(process.cwd(), ".lilto-provider-settings.json")
  }: {
    logger?: Logger;
    storagePath?: string;
  } = {}) {
    this.logger = logger;
    this.storagePath = storagePath;
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.storagePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.storagePath, "utf8");
      this.state = normalizeSettings(JSON.parse(raw));
    } catch (error) {
      this.logger.error("providers_load_failed", { error: String(error) });
      this.state = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
    }
  }

  private persist(): void {
    fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getState(): ProviderSettings {
    return {
      ...this.state,
      customProvider: { ...this.state.customProvider },
      networkProxy: { ...this.state.networkProxy }
    };
  }

  save(payload: unknown): ProviderSettingsSaveResult {
    if (!isValidSavePayload(payload)) {
      return {
        ok: false,
        error: {
          code: "INVALID_PROVIDER_SETTINGS",
          message: "provider settings の形式が不正です"
        }
      };
    }

    const normalized = normalizeSettings(payload);
    if (!isValidProxyUrl(normalized.networkProxy.httpProxy) || !isValidProxyUrl(normalized.networkProxy.httpsProxy)) {
      return {
        ok: false,
        error: {
          code: "INVALID_PROVIDER_SETTINGS",
          message: "Proxy URL は http(s) 形式で入力してください"
        }
      };
    }

    this.state = normalized;
    this.state.updatedAt = Date.now();
    this.persist();

    return { ok: true, state: this.getState() };
  }
}

export function isCustomProviderReady(settings: ProviderSettings): boolean {
  return Boolean(settings.customProvider.name.trim() && settings.customProvider.baseUrl.trim());
}
