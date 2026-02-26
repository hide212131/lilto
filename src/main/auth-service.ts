import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { createLogger, type Logger } from "./logger";
import { OAUTH_PROVIDER_IDS, type OAuthProviderId } from "../shared/provider-settings";

export type OAuthCredentials = {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
};

type OAuthPrompt = {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

type OAuthAuthInfo = {
  url: string;
  instructions?: string;
};

type OAuthProvider = {
  login: (callbacks: {
    onAuth: (info: OAuthAuthInfo) => void;
    onPrompt: (prompt: OAuthPrompt) => Promise<string>;
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
  }) => Promise<OAuthCredentials>;
};

export type AuthPhase =
  | "unauthenticated"
  | "auth_in_progress"
  | "awaiting_code"
  | "authenticated"
  | "auth_failed";

export type AuthState = {
  phase: AuthPhase;
  provider: OAuthProviderId;
  message: string;
  authUrl: string | null;
  updatedAt: number;
};

type AuthStoreShape = {
  credentials?: Partial<Record<OAuthProviderId, OAuthCredentials>>;
  lastProvider?: OAuthProviderId;
  anthropic?: OAuthCredentials;
};

const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

async function defaultProviderFactory(providerId: OAuthProviderId): Promise<OAuthProvider> {
  const { getOAuthProvider } = (await importEsm("@mariozechner/pi-ai")) as {
    getOAuthProvider: (id: string) => OAuthProvider | undefined;
  };
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`${providerId} OAuth provider が見つかりません`);
  }
  return provider as OAuthProvider;
}

function normalizeState(
  prev: Partial<AuthState>,
  phase: AuthPhase,
  message: string,
  authUrl: string | null,
  provider: OAuthProviderId
): AuthState {
  return {
    ...prev,
    phase,
    provider,
    message,
    authUrl,
    updatedAt: Date.now()
  };
}

export class ClaudeAuthService {
  private readonly logger: Logger;
  private readonly providerFactory: (providerId: OAuthProviderId) => Promise<OAuthProvider>;
  private readonly authPath: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private state: AuthState = normalizeState({}, "unauthenticated", "未認証です。認証を開始してください。", null, "anthropic");
  private credentialsByProvider: Partial<Record<OAuthProviderId, OAuthCredentials>> = {};
  private listeners = new Set<(state: AuthState) => void>();
  private pendingCodeResolver: ((code: string) => void) | null = null;
  private loginAbortController: AbortController | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor({
    logger = createLogger("auth"),
    providerFactory = defaultProviderFactory,
    authPath = path.join(process.cwd(), ".lilto-auth.json"),
    openExternal = (url: string) => shell.openExternal(url)
  }: {
    logger?: Logger;
    providerFactory?: (providerId: OAuthProviderId) => Promise<OAuthProvider>;
    authPath?: string;
    openExternal?: (url: string) => Promise<void>;
  } = {}) {
    this.logger = logger;
    this.providerFactory = providerFactory;
    this.authPath = authPath;
    this.openExternal = openExternal;
    this.loadPersistedCredentials();

    if (process.env.LILTO_E2E_MOCK === "1") {
      this.setState("authenticated", "E2E モック認証済み", null, "anthropic");
    } else {
      const persistedProvider = this.getPersistedProvider();
      if (persistedProvider) {
        this.setState("authenticated", "認証情報を読み込みました。", null, persistedProvider);
      } else {
        this.setState("unauthenticated", "未認証です。認証を開始してください。", null, "anthropic");
      }
    }
  }

  private getPersistedProvider(): OAuthProviderId | null {
    if (this.credentialsByProvider[this.state.provider]) {
      return this.state.provider;
    }
    for (const providerId of OAUTH_PROVIDER_IDS) {
      if (this.credentialsByProvider[providerId]) {
        return providerId;
      }
    }
    return null;
  }

  private loadPersistedCredentials(): void {
    if (!fs.existsSync(this.authPath)) return;
    try {
      const raw = fs.readFileSync(this.authPath, "utf8");
      const parsed = JSON.parse(raw) as AuthStoreShape;
      const normalized: Partial<Record<OAuthProviderId, OAuthCredentials>> = {};
      if (parsed.credentials && typeof parsed.credentials === "object") {
        for (const providerId of OAUTH_PROVIDER_IDS) {
          const credential = parsed.credentials[providerId];
          if (credential && typeof credential === "object") {
            normalized[providerId] = credential;
          }
        }
      }
      if (!normalized.anthropic && parsed.anthropic && typeof parsed.anthropic === "object") {
        normalized.anthropic = parsed.anthropic;
      }
      this.credentialsByProvider = normalized;
      if (parsed.lastProvider && OAUTH_PROVIDER_IDS.includes(parsed.lastProvider)) {
        const last = parsed.lastProvider as OAuthProviderId;
        if (this.credentialsByProvider[last]) {
          this.state = normalizeState(this.state, this.state.phase, this.state.message, this.state.authUrl, last);
        }
      }
    } catch (error) {
      this.logger.error("auth_load_failed", { error: String(error) });
      this.credentialsByProvider = {};
    }
  }

  private persistCredentials(providerId: OAuthProviderId, credentials: OAuthCredentials): void {
    this.credentialsByProvider = { ...this.credentialsByProvider, [providerId]: credentials };
    const payload: AuthStoreShape = {
      credentials: this.credentialsByProvider,
      lastProvider: providerId,
      anthropic: this.credentialsByProvider.anthropic
    };
    fs.writeFileSync(this.authPath, JSON.stringify(payload, null, 2), "utf8");
  }

  private clearPendingCode(): void {
    this.pendingCodeResolver = null;
  }

  private setState(phase: AuthPhase, message: string, authUrl: string | null, provider: OAuthProviderId): void {
    this.state = normalizeState(this.state, phase, message, authUrl, provider);
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startOAuth(providerId: OAuthProviderId = "anthropic"): Promise<AuthState> {
    if (this.loginPromise) {
      return this.state;
    }

    const controller = new AbortController();
    this.loginAbortController = controller;
    this.loginPromise = (async () => {
      try {
        this.setState("auth_in_progress", "認証ブラウザを起動しています...", null, providerId);
        const provider = await this.providerFactory(providerId);

        const credentials = await provider.login({
          onAuth: (info) => {
            this.setState("auth_in_progress", "外部ブラウザで認証を完了してください。", info.url, providerId);
            void this.openExternal(info.url).catch((error) => {
              this.logger.error("oauth_open_external_failed", { error: String(error) });
            });
          },
          onProgress: (message) => {
            this.setState("auth_in_progress", message, this.state.authUrl, providerId);
          },
          onPrompt: async (prompt) => {
            this.setState("awaiting_code", prompt.message || "認証コードを入力してください。", this.state.authUrl, providerId);
            return new Promise<string>((resolve) => {
              this.pendingCodeResolver = resolve;
            });
          },
          signal: controller.signal
        });

        this.persistCredentials(providerId, credentials);
        this.setState("authenticated", "認証が完了しました。すぐにチャットできます。", null, providerId);
      } catch (error) {
        this.setState("auth_failed", `認証に失敗しました: ${String(error)}`, this.state.authUrl, providerId);
      } finally {
        this.clearPendingCode();
        this.loginAbortController = null;
        this.loginPromise = null;
      }
    })();

    await this.loginPromise;
    return this.state;
  }

  submitAuthorizationCode(code: string): AuthState {
    const normalized = this.extractAuthorizationCode(code);
    if (!normalized) {
      throw new Error("認証コードが空です。");
    }
    if (!this.pendingCodeResolver) {
      throw new Error("現在入力待ちの認証コードはありません。");
    }
    this.pendingCodeResolver(normalized);
    this.clearPendingCode();
    this.setState("auth_in_progress", "認証コードを確認中です...", this.state.authUrl, this.state.provider);
    return this.state;
  }

  private extractAuthorizationCode(input: string): string {
    const raw = input.trim();
    if (!raw) return "";

    if (/^\S+#\S+$/.test(raw)) {
      return raw;
    }

    // Support pasted full instructions such as:
    // "Authentication Code ... Paste this into Claude Code:"
    const match = raw.match(/([^\s#]+#[^\s]+)/);
    return match ? match[1] : raw;
  }

  async getApiKey(providerId: OAuthProviderId): Promise<string | null> {
    if (process.env.LILTO_E2E_MOCK === "1") {
      return `mock-${providerId}-access-token`;
    }

    const credentials = this.credentialsByProvider[providerId];
    if (!credentials) return null;

    const { getOAuthApiKey } = (await importEsm("@mariozechner/pi-ai")) as {
      getOAuthApiKey: (
        providerId: string,
        credentials: Record<string, OAuthCredentials>
      ) => Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null>;
    };
    const result = await getOAuthApiKey(providerId, { [providerId]: credentials });
    if (!result) return null;

    if (result.newCredentials.expires !== credentials.expires || result.newCredentials.access !== credentials.access) {
      this.persistCredentials(providerId, result.newCredentials as OAuthCredentials);
    }
    return result.apiKey;
  }

  dispose(): void {
    this.loginAbortController?.abort();
    this.loginAbortController = null;
    this.loginPromise = null;
    this.clearPendingCode();
  }
}
