type SubmitResult =
  | { ok: true; response: { text: string } }
  | { ok: false; error?: { code?: string; message?: string; retryable?: boolean } };

type AuthPhase =
  | "unauthenticated"
  | "auth_in_progress"
  | "awaiting_code"
  | "authenticated"
  | "auth_failed";

type AuthState = {
  phase: AuthPhase;
  provider: "anthropic";
  message: string;
  authUrl: string | null;
  updatedAt: number;
};

type AuthStartResult = {
  ok: boolean;
  state: AuthState;
};

type AuthCodeResult =
  | { ok: true; state: AuthState }
  | { ok: false; error: { code: string; message: string } };

interface Window {
  lilt: {
    submitPrompt: (text: string) => Promise<SubmitResult>;
    startClaudeOauth: () => Promise<AuthStartResult>;
    submitAuthCode: (code: string) => Promise<AuthCodeResult>;
    getAuthState: () => Promise<AuthState>;
    onAuthStateChanged: (listener: (state: AuthState) => void) => () => void;
  };
}

const promptEl = document.getElementById("prompt") as HTMLTextAreaElement;
const sendEl = document.getElementById("send") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const authStatusEl = document.getElementById("auth-status") as HTMLSpanElement;
const authStartEl = document.getElementById("auth-start") as HTMLButtonElement;
const authCodeEl = document.getElementById("auth-code") as HTMLInputElement;
const authCodeSubmitEl = document.getElementById("auth-code-submit") as HTMLButtonElement;
const authCodeRowEl = document.getElementById("auth-code-row") as HTMLDivElement;

let authState: AuthState | null = null;

function renderAuthState(state: AuthState): void {
  authState = state;
  authStatusEl.textContent = state.message;
  authCodeRowEl.style.display = "flex";
  const codeInputEnabled = state.phase === "awaiting_code";
  authCodeEl.disabled = !codeInputEnabled;
  authCodeSubmitEl.disabled = !codeInputEnabled;
  authStartEl.disabled = state.phase === "auth_in_progress" || state.phase === "awaiting_code";
  sendEl.disabled = state.phase !== "authenticated";
  if (state.phase !== "authenticated" && statusEl.textContent === "待機中") {
    statusEl.textContent = "認証が必要です";
  }
  if (codeInputEnabled) {
    authCodeEl.focus();
  }
}

async function hydrateAuthState(): Promise<void> {
  try {
    const state = await window.lilt.getAuthState();
    renderAuthState(state);
  } catch (error) {
    authStatusEl.textContent = `認証状態の取得に失敗: ${String(error)}`;
  }
}

window.lilt.onAuthStateChanged((state) => {
  renderAuthState(state);
});

void hydrateAuthState();

authStartEl.addEventListener("click", async () => {
  authStatusEl.textContent = "OAuth を開始しています...";
  const result = await window.lilt.startClaudeOauth();
  renderAuthState(result.state);
});

authCodeSubmitEl.addEventListener("click", async () => {
  const code = authCodeEl.value.trim();
  if (!code) {
    authStatusEl.textContent = "認証コードを入力してください。";
    return;
  }

  const result = await window.lilt.submitAuthCode(code);
  if (result.ok) {
    authCodeEl.value = "";
    renderAuthState(result.state);
    return;
  }
  authStatusEl.textContent = `${result.error.code}: ${result.error.message}`;
});

authCodeEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    authCodeSubmitEl.click();
  }
});

sendEl.addEventListener("click", async () => {
  if (!authState || authState.phase !== "authenticated") {
    statusEl.textContent = "認証が必要です";
    outputEl.textContent = "Claude OAuth 認証を完了してから送信してください。";
    return;
  }

  const text = promptEl.value.trim();
  if (!text) {
    statusEl.textContent = "入力が空です";
    return;
  }

  statusEl.textContent = "送信中...";
  outputEl.textContent = "処理中...";

  const result = await window.lilt.submitPrompt(text);
  if (result.ok) {
    outputEl.textContent = result.response.text;
    statusEl.textContent = "完了";
    return;
  }

  const error = result.error || { code: "UNKNOWN", message: "不明なエラー" };
  outputEl.textContent = `${error.code}: ${error.message}`;
  if (error.code === "AUTH_REQUIRED") {
    statusEl.textContent = "認証が必要です";
    return;
  }
  statusEl.textContent = "エラー";
});
