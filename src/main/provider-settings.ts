import fs from "node:fs";
import path from "node:path";
import { createLogger, type Logger } from "./logger";
import {
  type ActiveProvider,
  type ChatSettings,
  type CustomProviderSettings,
  DEFAULT_CHAT_SETTINGS,
  type NetworkProxySettings,
  OAUTH_PROVIDER_IDS,
  type OAuthProviderId,
  type ProviderSettings
} from "../shared/provider-settings";

export type {
  ActiveProvider,
  ChatSettings,
  CustomProviderSettings,
  NetworkProxySettings,
  OAuthProviderId,
  ProviderSettings
} from "../shared/provider-settings";

export type ProviderSettingsSaveResult =
  | { ok: true; state: ProviderSettings }
  | { ok: false; error: { code: "INVALID_PROVIDER_SETTINGS"; message: string } };

const DEFAULT_MODEL_ID = "gpt-5.3-codex";
const PROVIDER_SETTINGS_PATH_ENV = "LILTO_PROVIDER_SETTINGS_PATH";

function defaultProviderSettingsPath(): string {
  const fromEnv = process.env[PROVIDER_SETTINGS_PATH_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return path.join(process.cwd(), ".lilto-provider-settings.json");
}

function hasProxyEnvironment(): boolean {
  const vars = [process.env.HTTP_PROXY, process.env.http_proxy, process.env.HTTPS_PROXY, process.env.https_proxy];
  return vars.some((value) => typeof value === "string" && value.trim().length > 0);
}

function defaultGlobalShortcut(): string {
  return process.platform === "darwin" ? "Command+L" : "Alt+L";
}

function createDefaultSettings(): ProviderSettings {
  return {
    activeProvider: "oauth",
    oauthProvider: "openai-codex",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "OpenAI API Key",
      baseUrl: "",
      apiKey: "",
      modelId: "gpt-5.3-codex"
    },
    networkProxy: { useProxy: hasProxyEnvironment() },
    chatSettings: { ...DEFAULT_CHAT_SETTINGS, globalShortcut: defaultGlobalShortcut() },
    updatedAt: Date.now()
  };
}

function toTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeActiveProvider(value: unknown): ActiveProvider {
  return value === "custom-openai-completions" ? "custom-openai-completions" : "oauth";
}

function normalizeOAuthProvider(value: unknown): OAuthProviderId {
  if (typeof value !== "string") {
    return "openai-codex";
  }
  return OAUTH_PROVIDER_IDS.includes(value as OAuthProviderId) ? (value as OAuthProviderId) : "openai-codex";
}

function normalizeChatSettings(value: unknown): ChatSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enterToSend: typeof record.enterToSend === "boolean" ? record.enterToSend : DEFAULT_CHAT_SETTINGS.enterToSend,
    globalShortcut: typeof record.globalShortcut === "string" ? record.globalShortcut : defaultGlobalShortcut()
  };
}

function normalizeSettings(value: unknown): ProviderSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const activeProvider = normalizeActiveProvider(record.activeProvider);
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
  const rawModelId = toTrimmedString(custom.modelId, DEFAULT_MODEL_ID) || DEFAULT_MODEL_ID;
  const rawOauthModelId = toTrimmedString(record.oauthModelId, rawModelId) || DEFAULT_MODEL_ID;
  const normalizedOauthModelId = rawOauthModelId === "qwen2.5:0.5b" ? DEFAULT_MODEL_ID : rawOauthModelId;

  return {
    activeProvider,
    oauthProvider: normalizeOAuthProvider(record.oauthProvider),
    oauthModelId: normalizedOauthModelId,
    customProvider: {
      name: toTrimmedString(custom.name),
      baseUrl: toTrimmedString(custom.baseUrl),
      apiKey: typeof custom.apiKey === "string" ? custom.apiKey : "",
      modelId: rawModelId
    },
    networkProxy: {
      useProxy
    },
    chatSettings: normalizeChatSettings(record.chatSettings),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now()
  };
}

function isValidSavePayload(payload: unknown): payload is {
  activeProvider: ActiveProvider;
  oauthProvider?: OAuthProviderId;
  oauthModelId?: string;
  customProvider: CustomProviderSettings;
  networkProxy?: NetworkProxySettings;
  chatSettings?: ChatSettings;
} {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  if (
    record.activeProvider !== "oauth" &&
    record.activeProvider !== "custom-openai-completions"
  ) {
    return false;
  }
  if (record.oauthProvider !== undefined && !OAUTH_PROVIDER_IDS.includes(record.oauthProvider as OAuthProviderId)) {
    return false;
  }
  if (record.oauthModelId !== undefined && typeof record.oauthModelId !== "string") {
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

  if (record.networkProxy !== undefined) {
    if (!record.networkProxy || typeof record.networkProxy !== "object") return false;
    const proxy = record.networkProxy as Record<string, unknown>;
    if (typeof proxy.useProxy !== "boolean") return false;
  }

  if (record.chatSettings !== undefined) {
    if (!record.chatSettings || typeof record.chatSettings !== "object") return false;
    const chat = record.chatSettings as Record<string, unknown>;
    if (typeof chat.enterToSend !== "boolean") return false;
    if (chat.globalShortcut !== undefined && typeof chat.globalShortcut !== "string") return false;
  }

  return true;
}

export class ProviderSettingsService {
  private readonly logger: Logger;
  private readonly storagePath: string;
  private state: ProviderSettings = createDefaultSettings();

  constructor({
    logger = createLogger("providers"),
    storagePath = defaultProviderSettingsPath()
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
      networkProxy: { ...this.state.networkProxy },
      chatSettings: { ...this.state.chatSettings }
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
  return Boolean(settings.customProvider.apiKey.trim() || settings.customProvider.baseUrl.trim());
}
