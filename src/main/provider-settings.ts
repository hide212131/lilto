import fs from "node:fs";
import path from "node:path";
import { createLogger, type Logger } from "./logger";
import {
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

function hasProxyEnvironment(): boolean {
  const vars = [process.env.HTTP_PROXY, process.env.http_proxy, process.env.HTTPS_PROXY, process.env.https_proxy];
  return vars.some((value) => typeof value === "string" && value.trim().length > 0);
}

function createDefaultSettings(): ProviderSettings {
  return {
    activeProvider: "claude",
    customProvider: {
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      modelId: DEFAULT_MODEL_ID
    },
    networkProxy: { useProxy: hasProxyEnvironment() },
    updatedAt: Date.now()
  };
}

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
  const defaultUseProxy = hasProxyEnvironment();
  const useProxy = typeof proxy.useProxy === "boolean" ? proxy.useProxy : defaultUseProxy;

  return {
    activeProvider: normalizeActiveProvider(record.activeProvider),
    customProvider: {
      name: toTrimmedString(custom.name),
      baseUrl: toTrimmedString(custom.baseUrl),
      apiKey: typeof custom.apiKey === "string" ? custom.apiKey : "",
      modelId: toTrimmedString(custom.modelId, DEFAULT_MODEL_ID) || DEFAULT_MODEL_ID
    },
    networkProxy: {
      useProxy
    },
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now()
  };
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
  return typeof proxy.useProxy === "boolean";
}

export class ProviderSettingsService {
  private readonly logger: Logger;
  private readonly storagePath: string;
  private state: ProviderSettings = createDefaultSettings();

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
      this.state = createDefaultSettings();
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

    this.state = normalized;
    this.state.updatedAt = Date.now();
    this.persist();

    return { ok: true, state: this.getState() };
  }
}

export function isCustomProviderReady(settings: ProviderSettings): boolean {
  return Boolean(settings.customProvider.name.trim() && settings.customProvider.baseUrl.trim());
}
