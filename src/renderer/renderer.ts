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
  lilto: {
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
const messagesEl = document.getElementById("messages") as HTMLDivElement;
const authStatusEl = document.getElementById("auth-status") as HTMLSpanElement;
const authStartEl = document.getElementById("auth-start") as HTMLButtonElement;
const authCodeEl = document.getElementById("auth-code") as HTMLInputElement;
const authCodeSubmitEl = document.getElementById("auth-code-submit") as HTMLButtonElement;
const authCodeRowEl = document.getElementById("auth-code-row") as HTMLDivElement;
const settingsOpenEl = document.getElementById("settings-open") as HTMLButtonElement;
const settingsCloseEl = document.getElementById("settings-close") as HTMLButtonElement;
const settingsModalEl = document.getElementById("settings-modal") as HTMLDivElement;

let authState: AuthState | null = null;
let isSending = false;

function canSendPrompt(): boolean {
  return !!authState && authState.phase === "authenticated" && !isSending;
}

function syncSendControl(): void {
  sendEl.disabled = !canSendPrompt();
}

function openSettingsModal(): void {
  settingsModalEl.classList.add("open");
}

function closeSettingsModal(): void {
  settingsModalEl.classList.remove("open");
}

function addMessage(
  role: "user" | "assistant" | "system" | "error",
  text: string,
  options?: { pending?: boolean }
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `msg msg-${role}`;
  if (options?.pending) {
    row.classList.add("msg-pending");
  }
  row.textContent = text;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function renderAuthState(state: AuthState): void {
  authState = state;
  authStatusEl.textContent = state.message;
  authCodeRowEl.style.display = "flex";
  const codeInputEnabled = state.phase === "awaiting_code";
  authCodeEl.disabled = !codeInputEnabled;
  authCodeSubmitEl.disabled = !codeInputEnabled;
  authStartEl.disabled = state.phase === "auth_in_progress" || state.phase === "awaiting_code";
  syncSendControl();
  if (state.phase === "authenticated") {
    closeSettingsModal();
    if (statusEl.textContent === "認証が必要です") {
      statusEl.textContent = "待機中";
    }
  }
  if (state.phase !== "authenticated" && statusEl.textContent === "待機中") {
    statusEl.textContent = "認証が必要です";
  }
  if (codeInputEnabled) {
    authCodeEl.focus();
  }
}

async function hydrateAuthState(): Promise<void> {
  try {
    const state = await window.lilto.getAuthState();
    renderAuthState(state);
  } catch (error) {
    authStatusEl.textContent = `認証状態の取得に失敗: ${String(error)}`;
  }
}

window.lilto.onAuthStateChanged((state) => {
  renderAuthState(state);
});

void hydrateAuthState();

settingsOpenEl.addEventListener("click", () => {
  openSettingsModal();
});

settingsCloseEl.addEventListener("click", () => {
  closeSettingsModal();
});

settingsModalEl.addEventListener("click", (event) => {
  if (event.target === settingsModalEl) {
    closeSettingsModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettingsModal();
  }
});

authStartEl.addEventListener("click", async () => {
  authStatusEl.textContent = "OAuth を開始しています...";
  const result = await window.lilto.startClaudeOauth();
  renderAuthState(result.state);
});

authCodeSubmitEl.addEventListener("click", async () => {
  const code = authCodeEl.value.trim();
  if (!code) {
    authStatusEl.textContent = "認証コードを入力してください。";
    return;
  }

  const result = await window.lilto.submitAuthCode(code);
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
  if (isSending) {
    return;
  }

  if (!authState || authState.phase !== "authenticated") {
    statusEl.textContent = "認証が必要です";
    addMessage("system", "Claude OAuth 認証を完了してから送信してください。");
    openSettingsModal();
    return;
  }

  const text = promptEl.value.trim();
  if (!text) {
    statusEl.textContent = "入力が空です";
    return;
  }

  addMessage("user", text);
  promptEl.value = "";
  const pendingMessage = addMessage("assistant", "処理中...", { pending: true });
  isSending = true;
  syncSendControl();
  statusEl.textContent = "送信中...";

  try {
    const result = await window.lilto.submitPrompt(text);
    if (result.ok) {
      pendingMessage.classList.remove("msg-pending");
      pendingMessage.textContent = result.response.text;
      statusEl.textContent = "待機中";
      promptEl.focus();
      return;
    }

    const error = result.error || { code: "UNKNOWN", message: "不明なエラー" };
    pendingMessage.remove();
    addMessage("error", `${error.code}: ${error.message}`);
    if (error.code === "AUTH_REQUIRED") {
      statusEl.textContent = "認証が必要です";
      return;
    }
    statusEl.textContent = "エラー";
    promptEl.focus();
  } catch (error) {
    pendingMessage.remove();
    addMessage("error", `UNEXPECTED: ${String(error)}`);
    statusEl.textContent = "エラー";
  } finally {
    isSending = false;
    syncSendControl();
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!sendEl.disabled) {
      sendEl.click();
    }
  }
});
