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

type ActiveProvider = "claude" | "custom-openai-completions";

type ProviderSettings = {
  activeProvider: ActiveProvider;
  customProvider: {
    name: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
  };
  updatedAt: number;
};

type ProviderSaveResult =
  | { ok: true; state: ProviderSettings }
  | { ok: false; error: { code: string; message: string } };

interface Window {
  lilto: {
    submitPrompt: (text: string) => Promise<SubmitResult>;
    startClaudeOauth: () => Promise<AuthStartResult>;
    submitAuthCode: (code: string) => Promise<AuthCodeResult>;
    getAuthState: () => Promise<AuthState>;
    getProviderSettings: () => Promise<ProviderSettings>;
    saveProviderSettings: (settings: ProviderSettings) => Promise<ProviderSaveResult>;
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
const providerActiveClaudeEl = document.getElementById("provider-active-claude") as HTMLInputElement;
const providerActiveCustomEl = document.getElementById("provider-active-custom") as HTMLInputElement;
const providerSelectionStatusEl = document.getElementById("provider-selection-status") as HTMLSpanElement;
const claudeSectionEl = document.getElementById("claude-section") as HTMLElement;
const customProviderSectionEl = document.getElementById("custom-provider-section") as HTMLElement;
const customProviderNameEl = document.getElementById("custom-provider-name") as HTMLInputElement;
const customProviderBaseUrlEl = document.getElementById("custom-provider-base-url") as HTMLInputElement;
const customProviderApiKeyEl = document.getElementById("custom-provider-api-key") as HTMLInputElement;
const customProviderModelIdEl = document.getElementById("custom-provider-model-id") as HTMLInputElement;
const customProviderSaveEl = document.getElementById("custom-provider-save") as HTMLButtonElement;
const customProviderSaveStatusEl = document.getElementById("custom-provider-save-status") as HTMLSpanElement;

let authState: AuthState | null = null;
let providerSettings: ProviderSettings = {
  activeProvider: "claude",
  customProvider: {
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    modelId: "qwen2.5:0.5b"
  },
  updatedAt: Date.now()
};
let isSending = false;

function isClaudeReady(): boolean {
  return !!authState && authState.phase === "authenticated";
}

function isCustomProviderReady(): boolean {
  return Boolean(providerSettings.customProvider.name.trim() && providerSettings.customProvider.baseUrl.trim());
}

function requiredStateMessage(): string {
  if (providerSettings.activeProvider === "claude") {
    return "Claude 認証が必要です";
  }
  return "Custom Provider の設定が必要です";
}

function canSendPrompt(): boolean {
  if (isSending) return false;
  if (providerSettings.activeProvider === "claude") return isClaudeReady();
  return isCustomProviderReady();
}

function updateIdleStatus(): void {
  if (isSending) return;
  statusEl.textContent = canSendPrompt() ? "待機中" : requiredStateMessage();
}

function syncProviderSelectionUi(): void {
  providerActiveClaudeEl.checked = providerSettings.activeProvider === "claude";
  providerActiveCustomEl.checked = providerSettings.activeProvider === "custom-openai-completions";

  claudeSectionEl.classList.toggle("active", providerSettings.activeProvider === "claude");
  customProviderSectionEl.classList.toggle("active", providerSettings.activeProvider === "custom-openai-completions");
  providerSelectionStatusEl.textContent =
    providerSettings.activeProvider === "claude" ? "現在: Claude" : "現在: Custom Provider";
}

function syncCustomProviderForm(): void {
  customProviderNameEl.value = providerSettings.customProvider.name;
  customProviderBaseUrlEl.value = providerSettings.customProvider.baseUrl;
  customProviderApiKeyEl.value = providerSettings.customProvider.apiKey;
  customProviderModelIdEl.value = providerSettings.customProvider.modelId || "qwen2.5:0.5b";
}

function syncSendControl(): void {
  sendEl.disabled = !canSendPrompt();
  updateIdleStatus();
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
  if (state.phase === "authenticated" && providerSettings.activeProvider === "claude") {
    closeSettingsModal();
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

async function hydrateProviderSettings(): Promise<void> {
  try {
    const settings = await window.lilto.getProviderSettings();
    providerSettings = settings;
    syncProviderSelectionUi();
    syncCustomProviderForm();
    syncSendControl();
  } catch (error) {
    customProviderSaveStatusEl.textContent = `設定の取得に失敗: ${String(error)}`;
  }
}

async function persistProviderSettings(next: ProviderSettings, successMessage?: string): Promise<void> {
  const result = await window.lilto.saveProviderSettings(next);
  if (!result.ok) {
    customProviderSaveStatusEl.textContent = `${result.error.code}: ${result.error.message}`;
    return;
  }

  providerSettings = result.state;
  syncProviderSelectionUi();
  syncCustomProviderForm();
  syncSendControl();
  if (successMessage) {
    customProviderSaveStatusEl.textContent = successMessage;
  }
}

window.lilto.onAuthStateChanged((state) => {
  renderAuthState(state);
});

void Promise.all([hydrateAuthState(), hydrateProviderSettings()]);

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

providerActiveClaudeEl.addEventListener("change", async () => {
  if (!providerActiveClaudeEl.checked) return;
  const next: ProviderSettings = {
    ...providerSettings,
    activeProvider: "claude"
  };
  await persistProviderSettings(next);
});

providerActiveCustomEl.addEventListener("change", async () => {
  if (!providerActiveCustomEl.checked) return;
  const next: ProviderSettings = {
    ...providerSettings,
    activeProvider: "custom-openai-completions"
  };
  await persistProviderSettings(next);
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

customProviderSaveEl.addEventListener("click", async () => {
  const next: ProviderSettings = {
    ...providerSettings,
    customProvider: {
      name: customProviderNameEl.value.trim(),
      baseUrl: customProviderBaseUrlEl.value.trim(),
      apiKey: customProviderApiKeyEl.value,
      modelId: customProviderModelIdEl.value.trim() || "qwen2.5:0.5b"
    }
  };

  if (!next.customProvider.name || !next.customProvider.baseUrl) {
    customProviderSaveStatusEl.textContent = "name と baseUrl は必須です。";
    return;
  }

  await persistProviderSettings(next, "Custom Provider 設定を保存しました。");
});

sendEl.addEventListener("click", async () => {
  if (isSending) {
    return;
  }

  if (!canSendPrompt()) {
    statusEl.textContent = requiredStateMessage();
    if (providerSettings.activeProvider === "claude") {
      addMessage("system", "Claude OAuth 認証を完了してから送信してください。");
    } else {
      addMessage("system", "Custom Provider の name / baseUrl を設定して保存してから送信してください。");
    }
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
    if (error.code === "AUTH_REQUIRED" || error.code === "PROVIDER_CONFIG_REQUIRED") {
      statusEl.textContent = requiredStateMessage();
      openSettingsModal();
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
