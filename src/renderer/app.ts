import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { AuthState, ProviderSettings, Message } from "./types.js";
import "./components/top-bar.js";
import "./components/message-list.js";
import "./components/composer.js";
import "./components/settings-modal.js";
import type { LiltComposer } from "./components/composer.js";

@customElement("lilt-app")
export class LiltApp extends LitElement {
  @property({ type: Object }) authState: AuthState | null = null;
  @property({ type: Object }) providerSettings: ProviderSettings = {
    activeProvider: "claude",
    customProvider: {
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      modelId: "qwen2.5:0.5b"
    },
    updatedAt: Date.now()
  };
  @property({ type: Array }) messages: Message[] = [];
  @property({ type: Boolean }) isSending = false;
  @property({ type: Boolean }) settingsOpen = false;

  @query("lilt-composer") private _composer!: LiltComposer;

  private _unsubscribeAuthListener: (() => void) | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      background: var(--bg, #f3f3f4);
      color: var(--text, #1f2328);
    }
    .main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .stage {
      width: min(980px, calc(100vw - 24px));
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    @media (max-width: 720px) {
      .stage {
        width: calc(100vw - 12px);
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._hydrate();
    this._unsubscribeAuthListener = window.lilto.onAuthStateChanged((state) => {
      this.authState = state;
      this._syncSendability();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeAuthListener?.();
    this._unsubscribeAuthListener = null;
  }

  private async _hydrate() {
    const [authState, providerSettings] = await Promise.all([
      window.lilto.getAuthState(),
      window.lilto.getProviderSettings()
    ]);
    this.authState = authState;
    this.providerSettings = providerSettings;
    this._syncSendability();
  }

  private _canSend(): boolean {
    if (this.isSending) return false;
    if (this.providerSettings.activeProvider === "claude") {
      return this.authState?.phase === "authenticated";
    }
    const cp = this.providerSettings.customProvider;
    return Boolean(cp.name.trim() && cp.baseUrl.trim());
  }

  private _statusText(): string {
    if (this.isSending) return "送信中...";
    if (this._canSend()) return "待機中";
    if (this.providerSettings.activeProvider === "claude") return "Claude 認証が必要です";
    return "Custom Provider の設定が必要です";
  }

  private _syncSendability() {
    // Triggers re-render by updating isSending (no-op needed; reactive props handle it)
    this.requestUpdate();
  }

  render() {
    return html`
      <lilt-top-bar
        statusText=${this._statusText()}
        @open-settings=${() => { this.settingsOpen = true; }}
      ></lilt-top-bar>

      <div class="main">
        <div class="stage">
          <lilt-message-list .messages=${this.messages}></lilt-message-list>
          <lilt-composer
            .disabled=${!this._canSend()}
            @send-message=${this._onSendMessage}
          ></lilt-composer>
        </div>
      </div>

      <lilt-settings-modal
        .open=${this.settingsOpen}
        .authState=${this.authState}
        .providerSettings=${this.providerSettings}
        @close-settings=${() => { this.settingsOpen = false; }}
        @provider-settings-changed=${this._onProviderSettingsChanged}
        @auth-state-updated=${this._onAuthStateUpdated}
      ></lilt-settings-modal>
    `;
  }

  private _onAuthStateUpdated(e: CustomEvent<AuthState>) {
    this.authState = e.detail;
    this._syncSendability();
  }

  private _onProviderSettingsChanged(e: CustomEvent<ProviderSettings>) {
    this.providerSettings = e.detail;
    this._syncSendability();
  }

  private async _onSendMessage(e: CustomEvent<{ text: string }>) {
    const text = e.detail.text;
    if (!this._canSend() || !text) {
      if (!this._canSend()) {
        this._addMessage("system",
          this.providerSettings.activeProvider === "claude"
            ? "Claude OAuth 認証を完了してから送信してください。"
            : "Custom Provider の name / baseUrl を設定して保存してから送信してください。"
        );
        this.settingsOpen = true;
      }
      return;
    }

    this._addMessage("user", text);
    const pendingIdx = this._addPendingMessage("assistant", "処理中...");
    this.isSending = true;

    try {
      const result = await window.lilto.submitPrompt(text);
      if (result.ok) {
        this._resolvePendingMessage(pendingIdx, result.response.text);
        await this.updateComplete;
        this._composer?.focusInput();
        return;
      }
      const error = result.error ?? { code: "UNKNOWN", message: "不明なエラー" };
      this._removePendingMessage(pendingIdx);
      this._addMessage("error", `${error.code}: ${error.message}`);
      if (error.code === "AUTH_REQUIRED" || error.code === "PROVIDER_CONFIG_REQUIRED") {
        this.settingsOpen = true;
      }
    } catch (err) {
      this._removePendingMessage(pendingIdx);
      this._addMessage("error", `UNEXPECTED: ${String(err)}`);
    } finally {
      this.isSending = false;
    }
  }

  private _addMessage(role: Message["role"], text: string): number {
    const msg: Message = { role, text };
    this.messages = [...this.messages, msg];
    return this.messages.length - 1;
  }

  private _addPendingMessage(role: Message["role"], text: string): number {
    const msg: Message = { role, text, pending: true };
    this.messages = [...this.messages, msg];
    return this.messages.length - 1;
  }

  private _resolvePendingMessage(idx: number, text: string) {
    this.messages = this.messages.map((m, i) =>
      i === idx ? { ...m, text, pending: false } : m
    );
  }

  private _removePendingMessage(idx: number) {
    this.messages = this.messages.filter((_, i) => i !== idx);
  }
}
