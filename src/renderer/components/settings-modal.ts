import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AuthState, ActiveProvider, ProviderSettings, SkillInfo, SkillUpdateInfo } from "../types.js";
import { OAUTH_PROVIDER_IDS, type OAuthProviderId } from "../../shared/provider-settings.js";

@customElement("lilt-settings-modal")
export class LiltSettingsModal extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Object }) authState: AuthState | null = null;
  @property({ type: Object }) providerSettings: ProviderSettings = {
    activeProvider: "oauth",
    oauthProvider: "anthropic",
    customProvider: {
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      modelId: "qwen2.5:0.5b"
    },
    networkProxy: {
      useProxy: false
    },
    chatSettings: {
      enterToSend: false
    },
    updatedAt: Date.now()
  };

  // Local form state for custom provider fields
  @state() private _customName = "";
  @state() private _customBaseUrl = "";
  @state() private _customApiKey = "";
  @state() private _customModelId = "";
  @state() private _useProxy = false;
  @state() private _authCodeValue = "";
  @state() private _saveStatus = "";
  @state() private _providerSelStatus = "";
  @state() private _oauthProvider: OAuthProviderId = "anthropic";
  @state() private _activeSection: "providers" | "chat" = "providers";
  @state() private _enterToSend = false;
  @state() private _globalShortcut = "";
  @state() private _chatSaveStatus = "";
  @state() private _shortcutDialogOpen = false;
  @state() private _pendingShortcut = "";
  @state() private _shortcutError = "";

  // Tab state
  @state() private _activeTab: "providers" | "chat" | "skills" = "providers";

  // Skills state
  @state() private _skills: SkillInfo[] = [];
  @state() private _skillsLoading = false;
  @state() private _skillInstallUrl = "";
  @state() private _skillInstallStatus = "";
  @state() private _skillListStatus = "";
  @state() private _skillInstalling = false;
  @state() private _skillUpdates: SkillUpdateInfo[] = [];
  @state() private _skillUpdatesChecking = false;
  @state() private _skillUpdatesChecked = false;

  private readonly _isMac = window.lilto.getPlatform() === "darwin";

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
      const cs = this.providerSettings.chatSettings;
      this._customName = cp.name;
      this._customBaseUrl = cp.baseUrl;
      this._customApiKey = cp.apiKey;
      this._customModelId = cp.modelId;
      this._useProxy = np.useProxy;
      this._oauthProvider = this.providerSettings.oauthProvider;
      this._enterToSend = cs?.enterToSend ?? false;
      this._globalShortcut = cs?.globalShortcut ?? "";
    }
    if (changedProps.has("authState")) {
      const as = this.authState;
      // Auto-close on successful OAuth auth
      if (as?.phase === "authenticated" && this.providerSettings.activeProvider === "oauth") {
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
    .oauth-provider-row {
      margin-top: 10px;
      display: grid;
      gap: 4px;
      max-width: 360px;
      color: #374151;
      font-size: 14px;
    }
    .oauth-provider-row select {
      border: 1px solid var(--line, #dddddf);
      border-radius: 9px;
      padding: 9px 10px;
      background: #fff;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      font-size: 14px;
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
    .settings-menu-item {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 10px 12px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 6px;
      transition: background 0.15s;
    }
    .settings-menu-item.active {
      background: #111827;
      color: #fff;
      border-color: #111827;
    }
    .skill-install-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .skill-install-row input {
      flex: 1;
      min-width: 220px;
      border: 1px solid var(--line, #dddddf);
      border-radius: 9px;
      padding: 9px 10px;
      background: #fff;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      font-size: 14px;
    }
    .skills-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      margin-top: 12px;
    }
    .skills-table th {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 2px solid #e5e7eb;
      font-weight: 600;
      color: #374151;
    }
    .skills-table td {
      padding: 8px;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: top;
    }
    .skill-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .skill-badge.bundled {
      background: #e5e7eb;
      color: #374151;
    }
    .skill-badge.user {
      background: #d1fae5;
      color: #065f46;
    }
    .skill-filepath {
      font-family: monospace;
      font-size: 11px;
      color: #6b7280;
      word-break: break-all;
    }
    .btn-danger {
      background: #fee2e2;
      color: #991b1b;
      border-color: #fca5a5;
    }
    .btn-danger:hover {
      background: #fca5a5;
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
    .shortcut-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }
    .shortcut-btn {
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      letter-spacing: 0.02em;
      color: #111827;
    }
    .shortcut-btn:hover {
      background: #e5e7eb;
    }
    .shortcut-dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .shortcut-dialog {
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 14px;
      padding: 24px 28px;
      min-width: 320px;
      max-width: 420px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.2);
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    .shortcut-dialog h4 {
      margin: 0;
      font-size: 18px;
    }
    .shortcut-capture-area {
      border: 2px dashed #d1d5db;
      border-radius: 10px;
      padding: 18px;
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      min-height: 60px;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
      cursor: pointer;
      color: #111827;
      letter-spacing: 0.04em;
      transition: border-color 0.15s;
    }
    .shortcut-capture-area:focus {
      border-color: #6366f1;
    }
    .shortcut-capture-hint {
      font-size: 13px;
      color: #6b7280;
      text-align: center;
      margin: 0;
    }
    .shortcut-dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    .shortcut-error {
      font-size: 13px;
      color: #dc2626;
    }
  `;

  render() {
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
              <div
                class="settings-menu-item ${this._activeTab === "providers" ? "active" : ""}"
                @click=${() => this._switchTab("providers")}
              >Providers &amp; Models</div>
              <div
                class="settings-menu-item ${this._activeTab === "chat" ? "active" : ""}"
                @click=${() => this._switchTab("chat")}
              >Chat</div>
              <div
                class="settings-menu-item ${this._activeTab === "skills" ? "active" : ""}"
                @click=${() => this._switchTab("skills")}
              >Agent Skills</div>
            </div>
            <div class="settings-main">
              ${this._activeTab === "providers"
                ? this._renderProviders()
                : this._activeTab === "chat"
                  ? this._renderChatSection()
                  : this._renderSkills()}
            </div>
          </div>
        </div>
      </div>
      ${this._shortcutDialogOpen ? this._renderShortcutDialog() : ""}
    `;
  }

  private _renderProviders() {
    const ps = this.providerSettings;
    const as = this.authState;
    const isOAuthActive = ps.activeProvider === "oauth";
    const isCustomActive = ps.activeProvider === "custom-openai-completions";
    const authPhase = as?.phase ?? "unauthenticated";
    const authMessage = as?.message ?? "未認証です。認証を開始してください。";
    const codeInputEnabled = authPhase === "awaiting_code";
    const oauthBtnDisabled = authPhase === "auth_in_progress" || authPhase === "awaiting_code";

    return html`
      <h3>Providers &amp; Models</h3>
      <p>OAuth Provider と Custom Provider（OpenAI Completions Compatible）を設定できます。</p>

      <div class="provider-choice">
        <label>
          <input
            type="radio"
            name="active-provider"
            value="oauth"
            .checked=${isOAuthActive}
            @change=${() => this._changeProvider("oauth")}
          />
          OAuth Provider
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

      <section class="provider-section ${isOAuthActive ? "active" : ""}">
        <h4>OAuth Authorization</h4>
        <p>OAuth 認証を開始して、表示された認証コードを入力してください。</p>
        <label class="oauth-provider-row">
          OAuth Provider
          <select
            id="oauth-provider"
            .value=${this._oauthProvider}
            @change=${(e: Event) => {
              const value = (e.target as HTMLSelectElement).value as OAuthProviderId;
              this._oauthProvider = OAUTH_PROVIDER_IDS.includes(value) ? value : "anthropic";
            }}
          >
            ${OAUTH_PROVIDER_IDS.map((id) => html`<option value=${id}>${this._oauthProviderLabel(id)}</option>`)}
          </select>
        </label>
        <div class="auth-row">
          <button .disabled=${oauthBtnDisabled} @click=${this._startOauth}>
            OAuth で認証
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
          認証画面の「Authentication Code / Paste this into ...」で表示された値を貼り付けて送信してください。
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
            <input
              id="use-proxy"
              type="checkbox"
              .checked=${this._useProxy}
              @change=${(e: InputEvent) => {
                this._useProxy = (e.target as HTMLInputElement).checked;
              }}
            />
            Proxy を使う（HTTP_PROXY / HTTPS_PROXY / NO_PROXY を利用）
          </label>
        </div>
        <div class="provider-actions">
          <button @click=${this._saveProviderAndProxy}>Save Provider Settings</button>
          <span class="status">${this._saveStatus}</span>
        </div>
      </section>
    `;
  }

  private _renderSkills() {
    return html`
      <h3>Agent Skills</h3>
      <p>スキルをインストール・管理します。変更は次回の送信から反映されます。</p>
      <p><a href="https://skills.sh" @click=${this._openSkillsDirectory}>https://skills.sh</a> から公開スキルを探せます。</p>

      <section class="provider-section">
        <h4>スキルのインストール</h4>
        <p><code>npx skills add</code> 形式でソースを指定してインストールします（GitHub ショートハンド・URL・ローカルパス可）。</p>
        <div class="skill-install-row">
          <input
            placeholder="vercel-labs/agent-skills"
            .value=${this._skillInstallUrl}
            @input=${(e: InputEvent) => {
              this._skillInstallUrl = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void this._installSkill();
              }
            }}
          />
          <button .disabled=${this._skillInstalling || !this._skillInstallUrl.trim()} @click=${this._installSkill}>
            ${this._skillInstalling ? "インストール中..." : "インストール"}
          </button>
        </div>
        <span class="status">${this._skillInstallStatus}</span>
      </section>

      <section class="provider-section" style="margin-top: 12px;">
        <h4>
          インストール済みスキル
          <button style="margin-left: 10px; font-size: 13px; padding: 4px 10px;" @click=${this._loadSkills} .disabled=${this._skillsLoading}>
            ${this._skillsLoading ? "読み込み中..." : "更新"}
          </button>
        </h4>
        ${this._skillsLoading
          ? html`<p class="status">読み込み中...</p>`
          : this._skills.length === 0
            ? html`<p class="status">スキルが見つかりません。</p>`
            : html`
              <table class="skills-table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>バージョン</th>
                    <th>説明</th>
                    <th>種別</th>
                    <th>ファイルパス</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${this._skills.map((skill) => html`
                    <tr>
                      <td><strong>${skill.name}</strong></td>
                      <td>${skill.installedVersion ?? "不明"}</td>
                      <td>${skill.description}</td>
                      <td>
                        <span class="skill-badge ${skill.source}">
                          ${skill.source === "bundled" ? "組み込み" : "ユーザー"}
                        </span>
                      </td>
                      <td><span class="skill-filepath">${skill.filePath}</span></td>
                      <td>
                        ${skill.source === "user"
                          ? html`<button class="btn-danger" @click=${() => this._uninstallSkill(skill.filePath, skill.name)}>削除</button>`
                          : html`<span class="status">—</span>`}
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            `}
              ${this._skillListStatus ? html`<p class="status">${this._skillListStatus}</p>` : ""}
      </section>

      <section class="provider-section" style="margin-top: 12px;">
        <h4>
          アップデート確認
          <button style="margin-left: 10px; font-size: 13px; padding: 4px 10px;" @click=${this._checkUpdates} .disabled=${this._skillUpdatesChecking}>
            ${this._skillUpdatesChecking ? "確認中..." : "アップデートを確認"}
          </button>
        </h4>
        <p>GitHub / GitLab のリリースからインストールしたスキルの最新バージョンを確認します。</p>
        ${this._skillUpdatesChecked
          ? this._skillUpdates.length === 0
            ? html`<p class="status">アップデートが必要なスキルはありません。</p>`
            : html`
              <table class="skills-table">
                <thead>
                  <tr>
                    <th>スキル名</th>
                    <th>インストール済み</th>
                    <th>最新</th>
                    <th>状態</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${this._skillUpdates.map((u) => html`
                    <tr>
                      <td><strong>${u.skillName}</strong></td>
                      <td>${u.installedVersion ?? "不明"}</td>
                      <td>${u.latestVersion ?? "取得失敗"}</td>
                      <td>
                        ${u.updateAvailable
                          ? html`<span class="skill-badge user">更新あり</span>`
                          : html`<span class="skill-badge bundled">最新</span>`}
                      </td>
                      <td>
                        ${u.updateAvailable
                          ? html`<button @click=${() => this._updateSkill(u.sourceUrl)}>更新</button>`
                          : ""}
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            `
          : ""}
      </section>
    `;
  }

  private _switchTab(tab: "providers" | "chat" | "skills") {
    this._activeTab = tab;
    if (tab === "skills" && this._skills.length === 0 && !this._skillsLoading) {
      void this._loadSkills();
    }
  }

  private async _loadSkills() {
    this._skillsLoading = true;
    try {
      const result = await window.lilto.listSkills();
      if (result.ok) {
        this._skills = result.skills;
        this._skillListStatus = "";
      } else {
        this._skillListStatus = `一覧取得エラー: ${result.error}`;
      }
    } finally {
      this._skillsLoading = false;
    }
  }

  private async _installSkill() {
    const source = this._skillInstallUrl.trim();
    if (!source) return;
    this._skillInstalling = true;
    this._skillInstallStatus = "";
    try {
      const result = await window.lilto.installSkillFromSource(source);
      if (result.ok) {
        this._skillInstallStatus = `インストール完了（次回の送信から有効になります）`;
        this._skillInstallUrl = "";
        await this._loadSkills();
      } else {
        this._skillInstallStatus = `エラー: ${result.error}`;
      }
    } finally {
      this._skillInstalling = false;
    }
  }

  private async _uninstallSkill(filePath: string, skillName: string) {
    const confirmed = globalThis.confirm(`「${skillName}」を削除しますか？`);
    if (!confirmed) {
      return;
    }

    const result = await window.lilto.uninstallSkill(filePath);
    if (result.ok) {
      this._skillListStatus = "";
      await this._loadSkills();
    } else {
      this._skillListStatus = `削除エラー: ${result.error}`;
    }
  }

  private async _checkUpdates() {
    this._skillUpdatesChecking = true;
    this._skillUpdatesChecked = false;
    try {
      this._skillUpdates = (await window.lilto.checkSkillUpdates()).filter((item) => item.updateAvailable);
      this._skillUpdatesChecked = true;
    } finally {
      this._skillUpdatesChecking = false;
    }
  }

  private async _updateSkill(sourceUrl: string) {
    this._skillInstalling = true;
    this._skillInstallStatus = "";
    try {
      const result = await window.lilto.installSkillFromSource(sourceUrl);
      if (result.ok) {
        this._skillInstallStatus = `更新完了（次回の送信から有効になります）`;
        await this._loadSkills();
        await this._checkUpdates();
      } else {
        this._skillInstallStatus = `更新エラー: ${result.error}`;
      }
    } finally {
      this._skillInstalling = false;
    }
  }

  private _openSkillsDirectory = async (e: Event) => {
    e.preventDefault();
    await window.lilto.openExternalUrl("https://skills.sh");
  };

  private _close() {
    this.dispatchEvent(new CustomEvent("close-settings", { bubbles: true, composed: true }));
  }

  private _onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this._close();
  }

  private _renderProvidersSection(
    isOAuthActive: boolean,
    isCustomActive: boolean,
    authPhase: string,
    authMessage: string,
    codeInputEnabled: boolean,
    oauthBtnDisabled: boolean
  ) {
    return html`
      <h3>Providers &amp; Models</h3>
      <p>OAuth Provider と Custom Provider（OpenAI Completions Compatible）を設定できます。</p>

      <div class="provider-choice">
        <label>
          <input
            type="radio"
            name="active-provider"
            value="oauth"
            .checked=${isOAuthActive}
            @change=${() => this._changeProvider("oauth")}
          />
          OAuth Provider
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

      <section class="provider-section ${isOAuthActive ? "active" : ""}">
        <h4>OAuth Authorization</h4>
        <p>OAuth 認証を開始して、表示された認証コードを入力してください。</p>
        <label class="oauth-provider-row">
          OAuth Provider
          <select
            id="oauth-provider"
            .value=${this._oauthProvider}
            @change=${(e: Event) => {
              const value = (e.target as HTMLSelectElement).value as OAuthProviderId;
              this._oauthProvider = OAUTH_PROVIDER_IDS.includes(value) ? value : "anthropic";
            }}
          >
            ${OAUTH_PROVIDER_IDS.map((id) => html`<option value=${id}>${this._oauthProviderLabel(id)}</option>`)}
          </select>
        </label>
        <div class="auth-row">
          <button .disabled=${oauthBtnDisabled} @click=${this._startOauth}>
            OAuth で認証
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
          認証画面の「Authentication Code / Paste this into ...」で表示された値を貼り付けて送信してください。
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
            <input
              id="use-proxy"
              type="checkbox"
              .checked=${this._useProxy}
              @change=${(e: InputEvent) => {
                this._useProxy = (e.target as HTMLInputElement).checked;
              }}
            />
            Proxy を使う（HTTP_PROXY / HTTPS_PROXY / NO_PROXY を利用）
          </label>
        </div>
        <div class="provider-actions">
          <button @click=${this._saveProviderAndProxy}>Save Provider Settings</button>
          <span class="status">${this._saveStatus}</span>
        </div>
      </section>
    `;
  }

  private _renderChatSection() {
    const displayShortcut = this._formatShortcutDisplay(this._globalShortcut);
    return html`
      <h3>Chat</h3>
      <p>チャット画面の操作設定です。</p>
      <section class="provider-section active">
        <h4>送信操作</h4>
        <div class="input-grid">
          <label>
            <input
              id="enter-to-send"
              type="checkbox"
              .checked=${this._enterToSend}
              @change=${(e: InputEvent) => {
                this._enterToSend = (e.target as HTMLInputElement).checked;
              }}
            />
            Enter キーだけで送信する（Shift+Enter で改行）
          </label>
          <p style="margin:0;font-size:13px;color:var(--muted,#6b7280);">
            OFF の場合は従来通り Cmd/Ctrl + Enter で送信します。
          </p>
        </div>
        <div class="provider-actions">
          <button @click=${this._saveChatSettings}>Chat 設定を保存</button>
          <span class="status">${this._chatSaveStatus}</span>
        </div>
      </section>

      <section class="provider-section" style="margin-top: 12px;">
        <h4>グローバルショートカット</h4>
        <p>アプリが閉じている状態でもショートカットキーでアプリを開き、入力欄にフォーカスします。</p>
        <div class="shortcut-row">
          <button class="shortcut-btn" @click=${this._openShortcutDialog} title="クリックしてショートカットを変更">
            ${displayShortcut}
          </button>
          <span class="status">クリックして変更</span>
        </div>
      </section>
    `;
  }

  private async _saveChatSettings() {
    const next: ProviderSettings = {
      ...this.providerSettings,
      chatSettings: {
        enterToSend: this._enterToSend,
        globalShortcut: this._globalShortcut
      }
    };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._chatSaveStatus = "Chat 設定を保存しました。";
      this.dispatchEvent(
        new CustomEvent("provider-settings-changed", {
          detail: result.state,
          bubbles: true,
          composed: true
        })
      );
    } else {
      this._chatSaveStatus = `${result.error.code}: ${result.error.message}`;
    }
  }


  private async _changeProvider(provider: ActiveProvider) {
    const next: ProviderSettings = {
      ...this.providerSettings,
      activeProvider: provider,
      oauthProvider: this._oauthProvider
    };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._providerSelStatus = provider === "oauth" ? "現在: OAuth Provider" : "現在: Custom Provider";
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
      oauthProvider: this._oauthProvider,
      customProvider: {
        name: this._customName.trim(),
        baseUrl: this._customBaseUrl.trim(),
        apiKey: this._customApiKey,
        modelId: this._customModelId.trim() || "qwen2.5:0.5b"
      },
      networkProxy: {
        useProxy: this._useProxy
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
    const saveResult = await window.lilto.saveProviderSettings({
      ...this.providerSettings,
      oauthProvider: this._oauthProvider
    });
    if (saveResult.ok) {
      this.dispatchEvent(
        new CustomEvent("provider-settings-changed", {
          detail: saveResult.state,
          bubbles: true,
          composed: true
        })
      );
    } else {
      this._saveStatus = `${saveResult.error.code}: ${saveResult.error.message}`;
      return;
    }

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

  private _oauthProviderLabel(provider: OAuthProviderId): string {
    switch (provider) {
      case "anthropic":
        return "Anthropic";
      case "openai-codex":
        return "OpenAI Codex";
      case "github-copilot":
        return "GitHub Copilot";
      case "google-gemini-cli":
        return "Google Gemini CLI";
      case "google-antigravity":
        return "Google Antigravity";
      default:
        return provider;
    }
  }

  private _formatShortcutDisplay(accelerator: string): string {
    if (!accelerator) return "—";
    const isMac = this._isMac;
    return accelerator
      .split("+")
      .map((part) => {
        switch (part) {
          case "Command": return "⌘";
          case "CommandOrControl": return isMac ? "⌘" : "Ctrl";
          case "Control": return isMac ? "⌃" : "Ctrl";
          case "Shift": return isMac ? "⇧" : "Shift";
          case "Alt":
          case "Option": return isMac ? "⌥" : "Alt";
          case "Super": return isMac ? "⌘" : "Win";
          default: return part.toUpperCase();
        }
      })
      .join(isMac ? "" : "+");
  }

  private _openShortcutDialog() {
    this._pendingShortcut = this._globalShortcut;
    this._shortcutError = "";
    this._shortcutDialogOpen = true;
    // Focus the capture area after render
    this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(".shortcut-capture-area")?.focus();
    });
  }

  private _closeShortcutDialog() {
    this._shortcutDialogOpen = false;
    this._pendingShortcut = "";
    this._shortcutError = "";
  }

  private _onShortcutCaptureKeydown(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Ignore modifier-only keypresses
    if (["Control", "Shift", "Alt", "Meta", "OS", "Super"].includes(e.key)) {
      return;
    }

    // Build accelerator string
    const parts: string[] = [];
    const isMac = this._isMac;

    if (e.metaKey) parts.push(isMac ? "Command" : "Super");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    // Require at least one modifier
    if (parts.length === 0) {
      this._shortcutError = "修飾キー（Command / Ctrl / Alt / Shift）を組み合わせてください。";
      return;
    }

    // Normalize key name
    let key = e.key;
    if (key.length === 1) {
      key = key.toUpperCase();
    } else {
      // Handle special keys
      const keyMap: Record<string, string> = {
        " ": "Space",
        ArrowUp: "Up",
        ArrowDown: "Down",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        Escape: "Escape",
        Enter: "Return",
        Backspace: "Backspace",
        Delete: "Delete",
        Tab: "Tab",
        Home: "Home",
        End: "End",
        PageUp: "PageUp",
        PageDown: "PageDown"
      };
      key = keyMap[key] ?? key;
    }

    parts.push(key);
    this._pendingShortcut = parts.join("+");
    this._shortcutError = "";
  }

  private async _saveShortcut() {
    if (!this._pendingShortcut) {
      this._shortcutError = "ショートカットを入力してください。";
      return;
    }
    this._globalShortcut = this._pendingShortcut;
    this._closeShortcutDialog();
    // Save immediately
    const next: ProviderSettings = {
      ...this.providerSettings,
      chatSettings: {
        enterToSend: this._enterToSend,
        globalShortcut: this._globalShortcut
      }
    };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._chatSaveStatus = "ショートカットを保存しました。";
      this.dispatchEvent(
        new CustomEvent("provider-settings-changed", {
          detail: result.state,
          bubbles: true,
          composed: true
        })
      );
    } else {
      this._chatSaveStatus = `${result.error.code}: ${result.error.message}`;
    }
  }

  private _onShortcutDialogBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) this._closeShortcutDialog();
  }

  private _renderShortcutDialog() {
    const displayPending = this._pendingShortcut
      ? this._formatShortcutDisplay(this._pendingShortcut)
      : "キーを押してください…";
    return html`
      <div class="shortcut-dialog-backdrop" @click=${this._onShortcutDialogBackdropClick}>
        <div class="shortcut-dialog">
          <h4>グローバルショートカットの変更</h4>
          <p style="margin:0;font-size:14px;color:#374151;">
            新しいショートカットキーを押してください。
          </p>
          <div
            class="shortcut-capture-area"
            tabindex="0"
            @keydown=${this._onShortcutCaptureKeydown}
          >
            ${displayPending}
          </div>
          <p class="shortcut-capture-hint">
            macOS: Command / Shift / Option + 任意のキー<br>
            Windows: Alt / Ctrl / Shift + 任意のキー
          </p>
          ${this._shortcutError ? html`<span class="shortcut-error">${this._shortcutError}</span>` : ""}
          <div class="shortcut-dialog-actions">
            <button @click=${this._closeShortcutDialog}>キャンセル</button>
            <button
              .disabled=${!this._pendingShortcut}
              @click=${this._saveShortcut}
            >保存</button>
          </div>
        </div>
      </div>
    `;
  }
}
