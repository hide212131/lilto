import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { createLogger, type Logger } from "./logger";

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
  provider: "anthropic";
  message: string;
  authUrl: string | null;
  updatedAt: number;
};

type AuthStoreShape = {
  anthropic?: OAuthCredentials;
};

const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

async function defaultProviderFactory(): Promise<OAuthProvider> {
  const { getOAuthProvider } = (await importEsm("@mariozechner/pi-ai")) as {
    getOAuthProvider: (id: string) => OAuthProvider | undefined;
  };
  const provider = getOAuthProvider("anthropic");
  if (!provider) {
    throw new Error("Anthropic OAuth provider が見つかりません");
  }
  return provider as OAuthProvider;
}

function normalizeState(prev: Partial<AuthState>, phase: AuthPhase, message: string, authUrl: string | null): AuthState {
  return {
    ...prev,
    phase,
    provider: "anthropic",
    message,
    authUrl,
    updatedAt: Date.now()
  };
}

export class ClaudeAuthService {
  private readonly logger: Logger;
  private readonly providerFactory: () => Promise<OAuthProvider>;
  private readonly authPath: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private state: AuthState = normalizeState({}, "unauthenticated", "未認証です。認証を開始してください。", null);
  private credentials: OAuthCredentials | null = null;
  private listeners = new Set<(state: AuthState) => void>();
  private pendingCodeResolver: ((code: string) => void) | null = null;
  private loginAbortController: AbortController | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor({
    logger = createLogger("auth"),
    providerFactory = defaultProviderFactory,
    authPath = path.join(process.cwd(), ".lilt-auth.json"),
    openExternal = (url: string) => shell.openExternal(url)
  }: {
    logger?: Logger;
    providerFactory?: () => Promise<OAuthProvider>;
    authPath?: string;
    openExternal?: (url: string) => Promise<void>;
  } = {}) {
    this.logger = logger;
    this.providerFactory = providerFactory;
    this.authPath = authPath;
    this.openExternal = openExternal;
    this.loadPersistedCredentials();

    if (process.env.LILT_E2E_MOCK === "1") {
      this.setState("authenticated", "E2E モック認証済み", null);
    } else if (this.credentials) {
      this.setState("authenticated", "認証情報を読み込みました。", null);
    }
  }

  private loadPersistedCredentials(): void {
    if (!fs.existsSync(this.authPath)) return;
    try {
      const raw = fs.readFileSync(this.authPath, "utf8");
      const parsed = JSON.parse(raw) as AuthStoreShape;
      this.credentials = parsed.anthropic ?? null;
    } catch (error) {
      this.logger.error("auth_load_failed", { error: String(error) });
      this.credentials = null;
    }
  }

  private persistCredentials(credentials: OAuthCredentials): void {
    const payload: AuthStoreShape = { anthropic: credentials };
    fs.writeFileSync(this.authPath, JSON.stringify(payload, null, 2), "utf8");
    this.credentials = credentials;
  }

  private clearPendingCode(): void {
    this.pendingCodeResolver = null;
  }

  private setState(phase: AuthPhase, message: string, authUrl: string | null): void {
    this.state = normalizeState(this.state, phase, message, authUrl);
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

  async startOAuth(): Promise<AuthState> {
    if (this.loginPromise) {
      return this.state;
    }

    const controller = new AbortController();
    this.loginAbortController = controller;
    this.loginPromise = (async () => {
      try {
        this.setState("auth_in_progress", "認証ブラウザを起動しています...", null);
        const provider = await this.providerFactory();

        const credentials = await provider.login({
          onAuth: (info) => {
            this.setState("auth_in_progress", "外部ブラウザで認証を完了してください。", info.url);
            void this.openExternal(info.url).catch((error) => {
              this.logger.error("oauth_open_external_failed", { error: String(error) });
            });
          },
          onProgress: (message) => {
            this.setState("auth_in_progress", message, this.state.authUrl);
          },
          onPrompt: async (prompt) => {
            this.setState("awaiting_code", prompt.message || "認証コードを入力してください。", this.state.authUrl);
            return new Promise<string>((resolve) => {
              this.pendingCodeResolver = resolve;
            });
          },
          signal: controller.signal
        });

        this.persistCredentials(credentials);
        this.setState("authenticated", "認証が完了しました。すぐにチャットできます。", null);
      } catch (error) {
        this.setState("auth_failed", `認証に失敗しました: ${String(error)}`, this.state.authUrl);
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
    this.setState("auth_in_progress", "認証コードを確認中です...", this.state.authUrl);
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

  async getApiKey(): Promise<string | null> {
    if (process.env.LILT_E2E_MOCK === "1") {
      return "mock-anthropic-access-token";
    }

    if (!this.credentials) return null;

    const { getOAuthApiKey } = (await importEsm("@mariozechner/pi-ai")) as {
      getOAuthApiKey: (
        providerId: string,
        credentials: Record<string, OAuthCredentials>
      ) => Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null>;
    };
    const result = await getOAuthApiKey("anthropic", { anthropic: this.credentials });
    if (!result) return null;

    if (result.newCredentials.expires !== this.credentials.expires || result.newCredentials.access !== this.credentials.access) {
      this.persistCredentials(result.newCredentials as OAuthCredentials);
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
