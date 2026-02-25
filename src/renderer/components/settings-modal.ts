import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AuthState, ActiveProvider, ProviderSettings } from "../types.js";

@customElement("lilt-settings-modal")
export class LiltSettingsModal extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Object }) authState: AuthState | null = null;
  @property({ type: Object }) providerSettings: ProviderSettings = {
    activeProvider: "claude",
    customProvider: {
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      modelId: "qwen2.5:0.5b"
    },
    networkProxy: {
      httpProxy: "",
      httpsProxy: "",
      noProxy: ""
    },
    updatedAt: Date.now()
  };

  // Local form state for custom provider fields
  @state() private _customName = "";
  @state() private _customBaseUrl = "";
  @state() private _customApiKey = "";
  @state() private _customModelId = "";
  @state() private _httpProxy = "";
  @state() private _httpsProxy = "";
  @state() private _noProxy = "";
  @state() private _authCodeValue = "";
  @state() private _saveStatus = "";
  @state() private _providerSelStatus = "";

  private _boundKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.open) this._close();
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this._boundKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._boundKeydown);
  }

  willUpdate(changedProps: Map<string, unknown>) {
    // Sync form state from provider settings when external state changes.
    if (changedProps.has("providerSettings")) {
      const cp = this.providerSettings.customProvider;
      const np = this.providerSettings.networkProxy;
      this._customName = cp.name;
      this._customBaseUrl = cp.baseUrl;
      this._customApiKey = cp.apiKey;
      this._customModelId = cp.modelId;
      this._httpProxy = np.httpProxy;
      this._httpsProxy = np.httpsProxy;
      this._noProxy = np.noProxy;
    }
    if (changedProps.has("authState")) {
      const as = this.authState;
      // Auto-close on successful Claude auth
      if (as?.phase === "authenticated" && this.providerSettings.activeProvider === "claude") {
        this._close();
      }
      // Focus code input when awaiting code
      if (as?.phase === "awaiting_code") {
        this.updateComplete.then(() => {
          this.renderRoot.querySelector<HTMLInputElement>("#auth-code")?.focus();
        });
      }
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .settings-modal {
      width: min(980px, calc(100vw - 24px));
      max-height: calc(100vh - 40px);
      overflow: auto;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
      padding: 18px 20px;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    .settings-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .settings-title {
      font-size: 32px;
      font-weight: 700;
    }
    .settings-body {
      display: grid;
      grid-template-columns: 250px 1fr;
      gap: 18px;
      margin-top: 10px;
    }
    .settings-menu {
      border-right: 1px solid #e5e7eb;
      padding-right: 12px;
    }
    .settings-menu-item {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 10px 12px;
      font-weight: 600;
    }
    .settings-main h3 {
      margin: 0 0 6px;
      font-size: 26px;
    }
    .settings-main p {
      margin: 0 0 14px;
      color: var(--muted, #6b7280);
    }
    .provider-choice {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .provider-choice label {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      font-size: 14px;
    }
    .provider-section {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 12px;
      margin-top: 10px;
      background: #fff;
    }
    .provider-section h4 {
      margin: 0 0 6px;
      font-size: 16px;
    }
    .provider-section p {
      margin-bottom: 10px;
    }
    .provider-section.active {
      border-color: #111827;
      box-shadow: 0 0 0 1px #111827 inset;
    }
    .auth-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .auth-code-row {
      margin-top: 10px;
      display: flex;
      gap: 8px;
    }
    .input-grid {
      display: grid;
      gap: 8px;
    }
    .input-grid label {
      display: grid;
      gap: 4px;
      font-size: 14px;
      color: #374151;
    }
    .auth-code-row input,
    .input-grid input {
      border: 1px solid var(--line, #dddddf);
      border-radius: 9px;
      padding: 9px 10px;
      background: #fff;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      font-size: 14px;
    }
    .auth-code-row input {
      flex: 1;
      min-width: 260px;
    }
    .provider-actions {
      margin-top: 10px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .status {
      font-size: 14px;
      color: var(--muted, #6b7280);
    }
    button {
      background: #f3f4f6;
      color: #111827;
      border: 1px solid #d1d5db;
      border-radius: 999px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .icon-btn {
      background: transparent;
      border: 0;
      color: #374151;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      padding: 0;
      cursor: pointer;
      font-size: 16px;
    }
    .icon-btn:hover {
      background: #f3f4f6;
    }
    @media (max-width: 720px) {
      .settings-body {
        grid-template-columns: 1fr;
      }
      .settings-menu {
        border-right: 0;
        padding-right: 0;
      }
      .settings-title {
        font-size: 24px;
      }
    }
  `;

  render() {
    const ps = this.providerSettings;
    const as = this.authState;
    const isClaudeActive = ps.activeProvider === "claude";
    const isCustomActive = ps.activeProvider === "custom-openai-completions";
    const authPhase = as?.phase ?? "unauthenticated";
    const authMessage = as?.message ?? "未認証です。認証を開始してください。";
    const codeInputEnabled = authPhase === "awaiting_code";
    const oauthBtnDisabled = authPhase === "auth_in_progress" || authPhase === "awaiting_code";

    return html`
      <div
        class="modal-backdrop ${this.open ? "open" : ""}"
        @click=${this._onBackdropClick}
      >
        <div class="settings-modal">
          <div class="settings-head">
            <div class="settings-title">Settings</div>
            <button class="icon-btn" @click=${this._close} type="button" title="Close">✕</button>
          </div>
          <div class="settings-body">
            <div class="settings-menu">
              <div class="settings-menu-item">Providers &amp; Models</div>
            </div>
            <div class="settings-main">
              <h3>Providers &amp; Models</h3>
              <p>Claude OAuth と Custom Provider（OpenAI Completions Compatible）を設定できます。</p>

              <div class="provider-choice">
                <label>
                  <input
                    type="radio"
                    name="active-provider"
                    value="claude"
                    .checked=${isClaudeActive}
                    @change=${() => this._changeProvider("claude")}
                  />
                  Claude
                </label>
                <label>
                  <input
                    type="radio"
                    name="active-provider"
                    value="custom-openai-completions"
                    .checked=${isCustomActive}
                    @change=${() => this._changeProvider("custom-openai-completions")}
                  />
                  Custom Provider
                </label>
                <span class="status">${this._providerSelStatus}</span>
              </div>

              <section class="provider-section ${isClaudeActive ? "active" : ""}">
                <h4>Claude Authorization</h4>
                <p>Claude OAuth を開始して、表示された認証コードを入力してください。</p>
                <div class="auth-row">
                  <button .disabled=${oauthBtnDisabled} @click=${this._startOauth}>
                    Claude OAuth で認証
                  </button>
                  <span class="status">${authMessage}</span>
                </div>
                <div class="auth-row auth-code-row">
                  <input
                    id="auth-code"
                    placeholder="Authentication Code（code#state）を貼り付け"
                    .value=${this._authCodeValue}
                    .disabled=${!codeInputEnabled}
                    @input=${(e: InputEvent) => {
                      this._authCodeValue = (e.target as HTMLInputElement).value;
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void this._submitCode();
                      }
                    }}
                  />
                  <button .disabled=${!codeInputEnabled} @click=${this._submitCode}>
                    コード送信
                  </button>
                </div>
                <div class="status">
                  Claude 画面の「Authentication Code / Paste this into Claude Code:」で表示された値を貼り付けて送信してください。
                </div>
              </section>

              <section class="provider-section ${isCustomActive ? "active" : ""}">
                <h4>Custom Provider (OpenAI Completions Compatible)</h4>
                <div class="input-grid">
                  <label>
                    Provider Name (Required)
                    <input
                      id="custom-provider-name"
                      placeholder="e.g., Ollama"
                      .value=${this._customName}
                      @input=${(e: InputEvent) => {
                        this._customName = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label>
                    Base URL (Required)
                    <input
                      id="custom-base-url"
                      placeholder="http://127.0.0.1:11434/v1"
                      .value=${this._customBaseUrl}
                      @input=${(e: InputEvent) => {
                        this._customBaseUrl = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label>
                    API Key (Optional)
                    <input
                      id="custom-api-key"
                      type="password"
                      placeholder="Leave empty if not required"
                      .value=${this._customApiKey}
                      @input=${(e: InputEvent) => {
                        this._customApiKey = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label>
                    Model ID
                    <input
                      id="custom-model-id"
                      placeholder="qwen2.5:0.5b"
                      .value=${this._customModelId}
                      @input=${(e: InputEvent) => {
                        this._customModelId = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                </div>
                <h4>Network Proxy</h4>
                <div class="input-grid">
                  <label>
                    HTTP Proxy
                    <input
                      id="http-proxy"
                      placeholder="http://proxy.example.local:8080"
                      .value=${this._httpProxy}
                      @input=${(e: InputEvent) => {
                        this._httpProxy = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label>
                    HTTPS Proxy
                    <input
                      id="https-proxy"
                      placeholder="http://proxy.example.local:8080"
                      .value=${this._httpsProxy}
                      @input=${(e: InputEvent) => {
                        this._httpsProxy = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label>
                    NO_PROXY
                    <input
                      id="no-proxy"
                      placeholder="localhost,127.0.0.1,.internal.local"
                      .value=${this._noProxy}
                      @input=${(e: InputEvent) => {
                        this._noProxy = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                </div>
                <div class="provider-actions">
                  <button @click=${this._saveProviderAndProxy}>Save Provider Settings</button>
                  <span class="status">${this._saveStatus}</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _close() {
    this.dispatchEvent(new CustomEvent("close-settings", { bubbles: true, composed: true }));
  }

  private _onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this._close();
  }

  private async _changeProvider(provider: ActiveProvider) {
    const next: ProviderSettings = { ...this.providerSettings, activeProvider: provider };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._providerSelStatus = provider === "claude" ? "現在: Claude" : "現在: Custom Provider";
      this.dispatchEvent(
        new CustomEvent("provider-settings-changed", {
          detail: result.state,
          bubbles: true,
          composed: true
        })
      );
    }
  }

  private async _saveProviderAndProxy() {
    if (!this._customName.trim() || !this._customBaseUrl.trim()) {
      this._saveStatus = "name と baseUrl は必須です。";
      return;
    }
    const next: ProviderSettings = {
      ...this.providerSettings,
      customProvider: {
        name: this._customName.trim(),
        baseUrl: this._customBaseUrl.trim(),
        apiKey: this._customApiKey,
        modelId: this._customModelId.trim() || "qwen2.5:0.5b"
      },
      networkProxy: {
        httpProxy: this._httpProxy.trim(),
        httpsProxy: this._httpsProxy.trim(),
        noProxy: this._noProxy.trim()
      }
    };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._saveStatus = "Provider 設定を保存しました。";
      this.dispatchEvent(
        new CustomEvent("provider-settings-changed", {
          detail: result.state,
          bubbles: true,
          composed: true
        })
      );
    } else {
      this._saveStatus = `${result.error.code}: ${result.error.message}`;
    }
  }

  private async _startOauth() {
    const result = await window.lilto.startClaudeOauth();
    this.dispatchEvent(
      new CustomEvent("auth-state-updated", {
        detail: result.state,
        bubbles: true,
        composed: true
      })
    );
  }

  private async _submitCode() {
    const code = this._authCodeValue.trim();
    if (!code) return;
    const result = await window.lilto.submitAuthCode(code);
    if (result.ok) {
      this._authCodeValue = "";
      this.dispatchEvent(
        new CustomEvent("auth-state-updated", {
          detail: result.state,
          bubbles: true,
          composed: true
        })
      );
    }
  }
}
