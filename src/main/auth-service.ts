import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createLogger, type Logger } from "./logger";
import { resolveCliInvocation } from "./command-compat";
import { shell } from "electron";
import { type OAuthProviderId } from "../shared/provider-settings";

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
  debug: AuthDebugInfo;
};

type AuthStoreShape = {
  apiKey?: string;
  lastChatGptLoginAt?: number;
};

export type AuthDebugInfo = {
  codexAuthPath: string;
  codexAuthFileExists: boolean;
  authSourcePath: string;
  authMode: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasOpenAiApiKey: boolean;
  hasStoredApiKey: boolean;
  isChatGptAuthenticated: boolean;
  lastCodexAuthReadError: string | null;
};

type CodexAuthJson = {
  auth_mode?: string | null;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string | null;
    refresh_token?: string | null;
  } | null;
};

type AuthInspectionResult = {
  authPath: string;
  fileExists: boolean;
  authMode: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasOpenAiApiKey: boolean;
  isChatGptAuthenticated: boolean;
  readError: string | null;
};

function normalizeState(
  prev: Partial<AuthState>,
  phase: AuthPhase,
  message: string,
  authUrl: string | null,
  provider: OAuthProviderId,
  debug: AuthDebugInfo
): AuthState {
  return {
    ...prev,
    phase,
    provider,
    message,
    authUrl,
    updatedAt: Date.now(),
    debug
  };
}

export class ClaudeAuthService {
  private readonly logger: Logger;
  private readonly authPath: string;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly codexHome: string;
  private readonly homeDir: string;
  private readonly codexAuthPath: string;
  private readonly fallbackCodexAuthPath: string;
  private readonly codexCommand: string;
  private state: AuthState = normalizeState(
    {},
    "unauthenticated",
    "未認証です。認証を開始してください。",
    null,
    "openai-codex",
    {
      codexAuthPath: "",
      codexAuthFileExists: false,
      authSourcePath: "",
      authMode: null,
      hasAccessToken: false,
      hasRefreshToken: false,
      hasOpenAiApiKey: false,
      hasStoredApiKey: false,
      isChatGptAuthenticated: false,
      lastCodexAuthReadError: null
    }
  );
  private apiKey: string | null = null;
  private listeners = new Set<(state: AuthState) => void>();
  private loginChild: ReturnType<typeof spawn> | null = null;
  private loginPromise: Promise<AuthState> | null = null;

  constructor({
    logger = createLogger("auth"),
    authPath = path.join(process.cwd(), ".lilto-auth.json"),
    openExternal = (url: string) => shell.openExternal(url),
    codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex"),
    homeDir = process.env.HOME || process.cwd(),
    fallbackCodexHome = path.join(process.env.HOME || process.cwd(), ".codex"),
    codexCommand = "codex"
  }: {
    logger?: Logger;
    authPath?: string;
    openExternal?: (url: string) => Promise<void>;
    codexHome?: string;
    homeDir?: string;
    fallbackCodexHome?: string;
    codexCommand?: string;
  } = {}) {
    this.logger = logger;
    this.authPath = authPath;
    this.openExternal = openExternal;
    this.codexHome = codexHome;
    this.homeDir = homeDir;
    this.codexAuthPath = path.join(codexHome, "auth.json");
    this.fallbackCodexAuthPath = path.join(fallbackCodexHome, "auth.json");
    this.codexCommand = codexCommand;
    this.loadPersistedState();
    this.migrateLegacyChatGptAuth();

    if (process.env.LILTO_E2E_MOCK === "1") {
      this.setState("authenticated", "E2E モック認証済み", null, "openai-codex");
    } else if (this.hasChatGptAuth()) {
      this.setState("authenticated", "Codex ChatGPT 認証を読み込みました。", null, "openai-codex");
    } else {
      this.setState("unauthenticated", "未認証です。認証を開始してください。", null, "openai-codex");
    }
  }

  private loadPersistedState(): void {
    if (!fs.existsSync(this.authPath)) return;
    try {
      const raw = fs.readFileSync(this.authPath, "utf8");
      const parsed = JSON.parse(raw) as AuthStoreShape;
      this.apiKey = typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey : null;
    } catch (error) {
      this.logger.error("auth_load_failed", { error: String(error) });
      this.apiKey = null;
    }
  }

  private persistState(): void {
    const payload: AuthStoreShape = {
      apiKey: this.apiKey ?? undefined,
      lastChatGptLoginAt: this.hasChatGptAuth() ? Date.now() : undefined
    };
    fs.writeFileSync(this.authPath, JSON.stringify(payload, null, 2), "utf8");
  }

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey?.trim() ? apiKey.trim() : null;
    this.persistState();
    if (!this.hasChatGptAuth()) {
      this.setState("unauthenticated", "未認証です。認証を開始してください。", null, "openai-codex");
    }
  }

  private setState(phase: AuthPhase, message: string, authUrl: string | null, provider: OAuthProviderId): void {
    this.state = normalizeState(this.state, phase, message, authUrl, provider, this.inspectAuthDebug());
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

  private hasChatGptAuth(): boolean {
    return this.inspectAuthDebug().isChatGptAuthenticated;
  }

  private inspectCodexAuthFile(authPath: string): AuthInspectionResult {
    const fileExists = fs.existsSync(authPath);
    let auth: CodexAuthJson | null = null;
    let readError: string | null = null;

    if (fileExists) {
      try {
        const raw = fs.readFileSync(authPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          auth = parsed as CodexAuthJson;
        }
      } catch (error) {
        readError = String(error);
        this.logger.error("codex_auth_read_failed", { authPath, error: readError });
      }
    }

    const accessToken = auth?.tokens?.access_token?.trim() ?? "";
    const refreshToken = auth?.tokens?.refresh_token?.trim() ?? "";
    const openAiApiKey = auth?.OPENAI_API_KEY?.trim() ?? "";
    const authMode = typeof auth?.auth_mode === "string" && auth.auth_mode.trim() ? auth.auth_mode.trim() : null;

    return {
      authPath,
      fileExists,
      authMode,
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
      hasOpenAiApiKey: Boolean(openAiApiKey),
      isChatGptAuthenticated: authMode === "chatgpt" && Boolean(accessToken || refreshToken),
      readError
    };
  }

  private migrateLegacyChatGptAuth(): void {
    const primary = this.inspectCodexAuthFile(this.codexAuthPath);
    if (primary.isChatGptAuthenticated || this.codexAuthPath === this.fallbackCodexAuthPath) {
      return;
    }

    const fallback = this.inspectCodexAuthFile(this.fallbackCodexAuthPath);
    if (!fallback.isChatGptAuthenticated) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.codexAuthPath), { recursive: true });
      fs.copyFileSync(this.fallbackCodexAuthPath, this.codexAuthPath);
      this.logger.info("codex_auth_migrated", {
        from: this.fallbackCodexAuthPath,
        to: this.codexAuthPath
      });
    } catch (error) {
      this.logger.error("codex_auth_migrate_failed", {
        from: this.fallbackCodexAuthPath,
        to: this.codexAuthPath,
        error: String(error)
      });
    }
  }

  private inspectAuthDebug(): AuthDebugInfo {
    const inspection = this.inspectCodexAuthFile(this.codexAuthPath);

    return {
      codexAuthPath: this.codexAuthPath,
      codexAuthFileExists: inspection.fileExists,
      authSourcePath: inspection.authPath,
      authMode: inspection.authMode,
      hasAccessToken: inspection.hasAccessToken,
      hasRefreshToken: inspection.hasRefreshToken,
      hasOpenAiApiKey: inspection.hasOpenAiApiKey,
      hasStoredApiKey: Boolean(this.apiKey),
      isChatGptAuthenticated: inspection.isChatGptAuthenticated,
      lastCodexAuthReadError: inspection.readError
    };
  }

  async startOAuth(providerId: OAuthProviderId = "openai-codex"): Promise<AuthState> {
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = (async () => {
      this.setState("auth_in_progress", "Codex ChatGPT 認証を開始しています...", null, providerId);
      try {
        const invocation = resolveCliInvocation(this.codexCommand, ["login"]);
        this.loginChild = spawn(invocation.command, invocation.args, {
          env: {
            ...process.env,
            ...(invocation.env ?? {}),
            HOME: this.homeDir,
            USERPROFILE: this.homeDir,
            CODEX_HOME: this.codexHome
          },
          stdio: "ignore"
        });
      } catch (error) {
        this.setState("auth_failed", `認証に失敗しました: ${String(error)}`, null, providerId);
        this.loginPromise = null;
        return this.state;
      }

      const state = await new Promise<AuthState>((resolve) => {
        this.loginChild?.once("error", async (error) => {
          this.logger.error("codex_login_spawn_failed", { error: String(error) });
          await this.openExternal("https://developers.openai.com/codex/auth").catch(() => {});
          this.setState(
            "auth_failed",
            "Codex login の起動に失敗しました。`codex login` を実行してから再試行してください。",
            "https://developers.openai.com/codex/auth",
            providerId
          );
          resolve(this.state);
        });

        this.loginChild?.once("close", async (code) => {
          this.loginChild = null;
          if (code === 0 && this.hasChatGptAuth()) {
            this.persistState();
            this.setState("authenticated", "Codex ChatGPT 認証が完了しました。", null, providerId);
          } else {
            await this.openExternal("https://developers.openai.com/codex/auth").catch(() => {});
            this.setState(
              "auth_failed",
              "Codex ChatGPT 認証を完了できませんでした。`codex login` を実行してから再試行してください。",
              "https://developers.openai.com/codex/auth",
              providerId
            );
          }
          resolve(this.state);
        });
      });

      this.loginPromise = null;
      return state;
    })();

    return this.loginPromise;
  }

  submitAuthorizationCode(_code?: string): AuthState {
    throw new Error("Codex ChatGPT 認証では認証コード入力は不要です。");
  }

  async getApiKey(providerId: OAuthProviderId): Promise<string | null> {
    if (providerId !== "openai-codex") {
      return null;
    }
    if (process.env.LILTO_E2E_MOCK === "1") {
      return "mock-openai-codex-access-token";
    }
    return this.apiKey;
  }

  dispose(): void {
    if (this.loginChild && !this.loginChild.killed) {
      this.loginChild.kill();
      this.loginChild = null;
    }
  }
}
