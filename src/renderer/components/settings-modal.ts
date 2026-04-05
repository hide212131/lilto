import { LitElement, html, css } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import type { HeartbeatAssistantStatus } from "../../shared/heartbeat-assistant.js";
import type { AuthState, ActiveProvider, PluginAppInfo, PluginCatalogInfo, PluginInfo, ProviderSettings, SkillInfo, SkillUpdateInfo } from "../types.js";
import type { OAuthProviderId, WindowsSandboxMode } from "../../shared/provider-settings.js";
import type { SchedulerScheduleSummary } from "../../shared/scheduler.js";

type ListedModel = {
  id: string;
  displayName: string;
};

function buildModelOptions(models: ListedModel[], selectedId: string, emptyLabel: string): ListedModel[] {
  const trimmedSelectedId = selectedId.trim();
  if (models.length === 0) {
    return trimmedSelectedId
      ? [{ id: trimmedSelectedId, displayName: trimmedSelectedId }]
      : [{ id: "", displayName: emptyLabel }];
  }
  if (!trimmedSelectedId || models.some((model) => model.id === trimmedSelectedId)) {
    return models;
  }
  return [{ id: trimmedSelectedId, displayName: trimmedSelectedId }, ...models];
}

@customElement("lilt-settings-modal")
export class LiltSettingsModal extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Object }) authState: AuthState | null = null;
  @property({ type: Object }) providerSettings: ProviderSettings = {
    activeProvider: "oauth",
    oauthProvider: "openai-codex",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "OpenAI API Key",
      baseUrl: "",
      apiKey: "",
      modelId: "gpt-5.3-codex"
    },
    networkProxy: {
      useProxy: false
    },
    windowsSandbox: {
      mode: "off",
      privateDesktop: true
    },
    chatSettings: {
      enterToSend: false,
      globalShortcut: ""
    },
    heartbeatSettings: {
      enabled: false,
      filePath: "",
      intervalMinutes: 30,
      showDesktopNotifications: true
    },
    updatedAt: Date.now()
  };

  // Local form state for custom provider fields
  @state() private _customName = "";
  @state() private _customBaseUrl = "";
  @state() private _customApiKey = "";
  @state() private _oauthModelId = "gpt-5.3-codex";
  @state() private _customModelId = "";
  @state() private _useProxy = false;
  @state() private _saveStatus = "";
  @state() private _providerSelStatus = "";
  @state() private _oauthProvider: OAuthProviderId = "openai-codex";
  @state() private _oauthModels: ListedModel[] = [];
  @state() private _customModels: ListedModel[] = [];
  @state() private _oauthModelsLoading = false;
  @state() private _customModelsLoading = false;
  @state() private _oauthModelsStatus = "";
  @state() private _customModelsStatus = "";
  @state() private _oauthSaveStatus = "";
  @state() private _windowsSandboxMode: WindowsSandboxMode = "off";
  @state() private _windowsSandboxPrivateDesktop = true;
  @state() private _windowsSandboxStatus = "Windows sandbox は無効です。";
  @state() private _windowsSandboxBusy = false;
  @state() private _activeSection: "providers" | "chat" = "providers";
  @state() private _enterToSend = false;
  @state() private _globalShortcut = "";
  @state() private _chatSaveStatus = "";
  @state() private _heartbeatEnabled = false;
  @state() private _heartbeatFilePath = "";
  @state() private _heartbeatIntervalMinutes = 30;
  @state() private _heartbeatShowDesktopNotifications = true;
  @state() private _heartbeatSaveStatus = "";
  @state() private _heartbeatStatus: HeartbeatAssistantStatus | null = null;
  @state() private _shortcutDialogOpen = false;
  @state() private _pendingShortcut = "";
  @state() private _shortcutError = "";

  // Tab state
  @state() private _activeTab: "providers" | "chat" | "heartbeat" | "skills" | "plugins" | "schedules" = "providers";

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
  @state() private _schedules: SchedulerScheduleSummary[] = [];
  @state() private _schedulesLoading = false;
  @state() private _scheduleStatus = "";
  @state() private _deletingScheduleId: string | null = null;
  @state() private _pluginCatalogs: PluginCatalogInfo[] = [];
  @state() private _marketplacePlugins: PluginInfo[] = [];
  @state() private _installedPlugins: PluginInfo[] = [];
  @state() private _pluginsLoading = false;
  @state() private _pluginListStatus = "";
  @state() private _pluginActionStatus = "";
  @state() private _pluginBusyKey: string | null = null;
  @state() private _pluginAppsById: Record<string, PluginAppInfo[]> = {};

  private readonly _isMac = window.lilto.getPlatform() === "darwin";
  private readonly _isWindows = window.lilto.getPlatform() === "win32";
  private _preserveWindowsSandboxStatusOnce = false;

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
      this._oauthModelId = this.providerSettings.oauthModelId;
      this._customModelId = cp.modelId;
      this._useProxy = np.useProxy;
      this._oauthProvider = this.providerSettings.oauthProvider;
      this._windowsSandboxMode = this.providerSettings.windowsSandbox?.mode ?? "off";
      this._windowsSandboxPrivateDesktop = this.providerSettings.windowsSandbox?.privateDesktop ?? true;
      this._enterToSend = cs?.enterToSend ?? false;
      this._globalShortcut = cs?.globalShortcut ?? "";
      this._heartbeatEnabled = this.providerSettings.heartbeatSettings?.enabled ?? false;
      this._heartbeatFilePath = this.providerSettings.heartbeatSettings?.filePath ?? "";
      this._heartbeatIntervalMinutes = this.providerSettings.heartbeatSettings?.intervalMinutes ?? 30;
      this._heartbeatShowDesktopNotifications =
        this.providerSettings.heartbeatSettings?.showDesktopNotifications ?? true;
      if (this._preserveWindowsSandboxStatusOnce) {
        this._preserveWindowsSandboxStatusOnce = false;
      } else {
        this._windowsSandboxStatus = this._describeWindowsSandboxStatus();
      }
    }
    if (changedProps.has("open") && this.open) {
      void this._loadOauthModels();
      if (this._customApiKey.trim() || this._customBaseUrl.trim()) {
        void this._loadCustomModels();
      }
      if (this._activeTab === "heartbeat") {
        void this._loadHeartbeatStatus();
      }
    }
    if (changedProps.has("authState")) {
      const as = this.authState;
      if (as?.phase === "authenticated") {
        void this._loadOauthModels();
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
      gap: 6px;
      color: #374151;
      font-size: 14px;
    }
    .field-label {
      display: grid;
      gap: 6px;
      font-size: 14px;
      color: #374151;
    }
    .select-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .field-select {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--line, #dddddf);
      border-radius: 12px;
      padding: 11px 14px;
      background: #fff;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      font-size: 15px;
      color: #111827;
      line-height: 1.4;
      box-sizing: border-box;
      appearance: none;
    }
    .field-select:disabled {
      background: #f9fafb;
      color: #9ca3af;
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
      gap: 6px;
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
    .checkbox-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      border: 1px solid #dddddf;
      border-radius: 12px;
      background: #fff;
      padding: 12px 14px;
      color: #111827;
      cursor: pointer;
      box-sizing: border-box;
    }
    .checkbox-card input {
      width: 18px;
      height: 18px;
      margin-top: 2px;
      flex: 0 0 auto;
    }
    .checkbox-copy {
      display: grid;
      gap: 4px;
    }
    .checkbox-title {
      font-size: 15px;
      font-weight: 600;
    }
    .checkbox-help {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
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
    .auth-debug {
      margin-top: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
      padding: 10px 12px;
    }
    .auth-debug summary {
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      color: #374151;
    }
    .auth-debug-grid {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 10px;
      margin-top: 10px;
      font-size: 13px;
      color: #374151;
      word-break: break-word;
    }
    .auth-debug-grid code {
      font-size: 12px;
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
    .schedule-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 180px;
    }
    .schedule-title {
      font-weight: 700;
      color: #111827;
    }
    .schedule-subtle {
      color: #6b7280;
      font-size: 12px;
      word-break: break-word;
    }
    .schedule-action {
      white-space: nowrap;
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
                class="settings-menu-item ${this._activeTab === "heartbeat" ? "active" : ""}"
                @click=${() => this._switchTab("heartbeat")}
              >Heartbeat</div>
              <div
                class="settings-menu-item ${this._activeTab === "schedules" ? "active" : ""}"
                @click=${() => this._switchTab("schedules")}
              >Schedules</div>
              <div
                class="settings-menu-item ${this._activeTab === "skills" ? "active" : ""}"
                @click=${() => this._switchTab("skills")}
              >Agent Skills</div>
              <div
                class="settings-menu-item ${this._activeTab === "plugins" ? "active" : ""}"
                @click=${() => this._switchTab("plugins")}
              >Plugins</div>
            </div>
            <div class="settings-main">
              ${this._activeTab === "providers"
                ? this._renderProviders()
                : this._activeTab === "chat"
                  ? this._renderChatSection()
                  : this._activeTab === "heartbeat"
                    ? this._renderHeartbeatSection()
                  : this._activeTab === "plugins"
                    ? this._renderPlugins()
                  : this._activeTab === "schedules"
                    ? this._renderSchedules()
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
    const oauthBtnDisabled = authPhase === "auth_in_progress";

    return html`
      <h3>Providers &amp; Models</h3>
      <p>Codex ChatGPT 認証と API key 実行を設定できます。</p>

      <div class="provider-choice">
        <label>
          <input
            type="radio"
            name="active-provider"
            value="oauth"
            .checked=${isOAuthActive}
            @change=${() => this._changeProvider("oauth")}
          />
          ChatGPT Login
        </label>
        <label>
          <input
            type="radio"
            name="active-provider"
            value="custom-openai-completions"
            .checked=${isCustomActive}
            @change=${() => this._changeProvider("custom-openai-completions")}
          />
          API Key
        </label>
        <span class="status">${this._providerSelStatus}</span>
      </div>

      <section class="provider-section ${isOAuthActive ? "active" : ""}">
        <h4>ChatGPT Authorization</h4>
        <p><code>codex login</code> を使ったブラウザ認証を開始します。</p>
        <div class="auth-row">
          <button .disabled=${oauthBtnDisabled} @click=${this._startOauth}>
            ChatGPT で認証
          </button>
          <span class="status">${authMessage}</span>
        </div>
        <label class="oauth-provider-row">
          Model
          <div class="select-row">
            <select
              class="field-select"
              id="oauth-model"
              .disabled=${this._oauthModelsLoading || this._oauthModelOptions.length === 0}
              .value=${live(this._oauthModelId || "")}
              @change=${(e: Event) => {
                this._oauthModelId = (e.target as HTMLSelectElement).value || "gpt-5.3-codex";
              }}
            >
              ${this._oauthModelOptions.map((model) => html`<option value=${model.id}>${model.displayName}</option>`)}
            </select>
            <button .disabled=${this._oauthModelsLoading} @click=${this._loadOauthModels}>
              ${this._oauthModelsLoading ? "取得中..." : "モデル一覧を取得"}
            </button>
          </div>
        </label>
        ${this._oauthModelsStatus ? html`<div class="status">${this._oauthModelsStatus}</div>` : ""}
        <div class="status">ブラウザ認証が終わると Codex のローカル認証状態を再利用します。</div>
        <div class="provider-actions">
          <button @click=${this._saveOauthSettings}>Model 設定を保存</button>
          <span class="status">${this._oauthSaveStatus}</span>
        </div>
        ${this._renderAuthDebug()}
      </section>

      <section class="provider-section ${isCustomActive ? "active" : ""}">
        <h4>API Key</h4>
        <div class="input-grid">
          <label>
            Label
            <input
              id="custom-provider-name"
              placeholder="OpenAI API Key"
              .value=${this._customName}
              @input=${(e: InputEvent) => {
                this._customName = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            Base URL (Optional)
            <input
              id="custom-base-url"
              placeholder="https://api.openai.com/v1"
              .value=${this._customBaseUrl}
              @input=${(e: InputEvent) => {
                this._customBaseUrl = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            API Key (Required unless local runtime ignores it)
            <input
              id="custom-api-key"
              type="password"
              placeholder="sk-..."
              .value=${this._customApiKey}
              @input=${(e: InputEvent) => {
                this._customApiKey = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            Model
            <div class="select-row">
              <select
                class="field-select"
                id="custom-model-id"
                .disabled=${this._customModelsLoading || this._customModelOptions.length === 0}
                .value=${live(this._customModelId || "")}
                @change=${(e: Event) => {
                  this._customModelId = (e.target as HTMLSelectElement).value || "";
                }}
              >
                ${this._customModelOptions.map((model) => html`<option value=${model.id}>${model.displayName}</option>`)}
              </select>
              <button .disabled=${this._customModelsLoading} @click=${this._loadCustomModels}>
                ${this._customModelsLoading ? "取得中..." : "モデル一覧を取得"}
              </button>
            </div>
          </label>
        </div>
        ${this._customModelsStatus ? html`<div class="status">${this._customModelsStatus}</div>` : ""}
        <h4>Network Proxy</h4>
        <div class="input-grid">
          <label class="checkbox-card">
            <input
              id="use-proxy"
              type="checkbox"
              .checked=${this._useProxy}
              @change=${(e: InputEvent) => {
                this._useProxy = (e.target as HTMLInputElement).checked;
              }}
            />
            <span class="checkbox-copy">
              <span class="checkbox-title">Proxy を使う</span>
              <span class="checkbox-help">HTTP_PROXY / HTTPS_PROXY / NO_PROXY を利用します。</span>
            </span>
          </label>
        </div>
        <div class="provider-actions">
          <button @click=${this._saveProviderAndProxy}>Save Settings</button>
          <span class="status">${this._saveStatus}</span>
        </div>
      </section>

      ${this._isWindows ? html`
        <section class="provider-section">
          <h4>Windows Sandbox</h4>
          <p>Windows では <code>workspace-write</code> 前提で Codex sandbox backend を使います。read-only は利用しません。</p>
          <div class="input-grid">
            <label>
              Mode
              <select
                id="windows-sandbox-mode"
                .disabled=${this._windowsSandboxBusy}
                .value=${this._windowsSandboxMode}
                @change=${(e: Event) => {
                  this._windowsSandboxMode = (e.target as HTMLSelectElement).value as WindowsSandboxMode;
                }}
              >
                <option value="off">off</option>
                <option value="unelevated">unelevated</option>
                <option value="elevated">elevated</option>
              </select>
            </label>
            <label>
              <input
                id="windows-sandbox-private-desktop"
                type="checkbox"
                .checked=${this._windowsSandboxPrivateDesktop}
                .disabled=${this._windowsSandboxBusy || this._windowsSandboxMode === "off"}
                @change=${(e: InputEvent) => {
                  this._windowsSandboxPrivateDesktop = (e.target as HTMLInputElement).checked;
                }}
              />
              private desktop を使う
            </label>
          </div>
          <div class="status">${this._windowsSandboxStatus}</div>
          <div class="provider-actions">
            <button .disabled=${this._windowsSandboxBusy} @click=${this._saveWindowsSandboxSettings}>
              ${this._windowsSandboxBusy ? "セットアップ中..." : "Windows sandbox 設定を保存"}
            </button>
          </div>
        </section>
      ` : ""}
    `;
  }

  private get _oauthModelOptions(): ListedModel[] {
    return buildModelOptions(this._oauthModels, this._oauthModelId, "モデル一覧を取得してください");
  }

  private get _customModelOptions(): ListedModel[] {
    return buildModelOptions(this._customModels, this._customModelId, "API key / Base URL を入力して一覧取得");
  }

  private _renderAuthDebug() {
    const debug = this.authState?.debug;
    if (!debug) {
      return "";
    }

    return html`
      <details class="auth-debug">
        <summary>ChatGPT auth debug</summary>
        <div class="auth-debug-grid">
          <strong>codex auth.json</strong>
          <code>${debug.codexAuthPath}</code>
          <strong>file exists</strong>
          <span>${debug.codexAuthFileExists ? "yes" : "no"}</span>
          <strong>auth_mode</strong>
          <span>${debug.authMode ?? "(none)"}</span>
          <strong>access token</strong>
          <span>${debug.hasAccessToken ? "present" : "missing"}</span>
          <strong>refresh token</strong>
          <span>${debug.hasRefreshToken ? "present" : "missing"}</span>
          <strong>OPENAI_API_KEY</strong>
          <span>${debug.hasOpenAiApiKey ? "present" : "missing"}</span>
          <strong>saved API key</strong>
          <span>${debug.hasStoredApiKey ? "present" : "missing"}</span>
          <strong>ChatGPT auth valid</strong>
          <span>${debug.isChatGptAuthenticated ? "yes" : "no"}</span>
          <strong>read error</strong>
          <span>${debug.lastCodexAuthReadError ?? "(none)"}</span>
        </div>
      </details>
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

  private _renderPlugins() {
    return html`
      <h3>Plugins</h3>
      <p>Codex plugin の marketplace 一覧、インストール済み一覧、install、uninstall を管理します。変更は次回の送信または新しい thread から反映されます。</p>

      <section class="provider-section">
        <h4>
          Marketplace sources
          <button style="margin-left: 10px; font-size: 13px; padding: 4px 10px;" @click=${() => this._loadPlugins(true)} .disabled=${this._pluginsLoading || this._pluginBusyKey !== null}>
            ${this._pluginsLoading ? "同期中..." : "更新"}
          </button>
        </h4>
        ${this._pluginCatalogs.length === 0
          ? html`<p class="status">利用可能な marketplace はまだありません。</p>`
          : html`
            <table class="skills-table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>種別</th>
                  <th>Plugin 数</th>
                  <th>パス</th>
                </tr>
              </thead>
              <tbody>
                ${this._pluginCatalogs.map((catalog) => html`
                  <tr>
                    <td><strong>${catalog.displayName}</strong></td>
                    <td>
                      <span class="skill-badge ${catalog.kind === "bundled" ? "bundled" : "user"}">
                        ${catalog.kind === "bundled" ? "組み込み" : "Official curated"}
                      </span>
                    </td>
                    <td>${catalog.pluginCount}</td>
                    <td><span class="skill-filepath">${catalog.marketplacePath}</span></td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </section>

      <section class="provider-section" style="margin-top: 12px;">
        <h4>Marketplace plugins</h4>
        ${this._marketplacePlugins.length === 0
          ? html`<p class="status">表示できる plugin がありません。</p>`
          : html`
            <table class="skills-table">
              <thead>
                <tr>
                  <th>Plugin</th>
                  <th>Marketplace</th>
                  <th>Category</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${this._marketplacePlugins.map((plugin) => {
                  const busyKey = `install:${plugin.id}`;
                  const disabled = this._pluginBusyKey !== null || plugin.installed || plugin.installPolicy !== "AVAILABLE";
                  return html`
                    <tr>
                      <td>
                        <div class="schedule-meta">
                          <span class="schedule-title">${plugin.displayName}</span>
                          <span class="schedule-subtle">${plugin.description ?? plugin.name}</span>
                          <span class="schedule-subtle">ID: ${plugin.id}</span>
                          ${plugin.featured ? html`<span class="schedule-subtle">featured</span>` : ""}
                        </div>
                      </td>
                      <td>
                        <div class="schedule-meta">
                          <span>${plugin.marketplaceName}</span>
                          <span class="schedule-subtle">${plugin.sourceKind === "bundled" ? "組み込み" : "Official curated"}</span>
                        </div>
                      </td>
                      <td>${plugin.category ?? "-"}</td>
                      <td>
                        ${plugin.installed
                          ? html`<span class="skill-badge user">インストール済み</span>`
                          : plugin.installPolicy === "NOT_AVAILABLE"
                            ? html`<span class="skill-badge bundled">利用不可</span>`
                            : plugin.installPolicy === "INSTALLED_BY_DEFAULT"
                              ? html`<span class="skill-badge bundled">標準</span>`
                              : html`<span class="skill-badge bundled">未導入</span>`}
                      </td>
                      <td>
                        <button
                          .disabled=${disabled}
                          @click=${() => this._installPlugin(plugin)}
                        >${this._pluginBusyKey === busyKey ? "インストール中..." : "インストール"}</button>
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          `}
      </section>

      <section class="provider-section" style="margin-top: 12px;">
        <h4>Installed plugins</h4>
        ${this._installedPlugins.length === 0
          ? html`<p class="status">インストール済み plugin はありません。</p>`
          : html`
            <table class="skills-table">
              <thead>
                <tr>
                  <th>Plugin</th>
                  <th>Marketplace</th>
                  <th>有効</th>
                  <th>導入元</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${this._installedPlugins.map((plugin) => {
                  const busyKey = `uninstall:${plugin.id}`;
                  return html`
                    <tr>
                      <td>
                        <div class="schedule-meta">
                          <span class="schedule-title">${plugin.displayName}</span>
                          <span class="schedule-subtle">${plugin.description ?? plugin.name}</span>
                          ${this._pluginAppsWithInstallUrl(plugin).length > 0
                            ? html`<span class="schedule-subtle">app: ${this._pluginAppsWithInstallUrl(plugin).map((app) => app.name).join(", ")}</span>`
                            : html``}
                          ${this._pluginAppsNeedingAuth(plugin).length > 0
                            ? html`<span class="schedule-subtle">接続が必要: ${this._pluginAppsNeedingAuth(plugin).map((app) => app.name).join(", ")}</span>`
                            : html``}
                        </div>
                      </td>
                      <td>${plugin.marketplaceName}</td>
                      <td>${this._pluginAppsNeedingAuth(plugin).length > 0 ? "接続待ち" : plugin.enabled ? "yes" : "no"}</td>
                      <td>${plugin.userInstalled ? "user-installed" : "system"}</td>
                      <td>
                        ${this._pluginAppsWithInstallUrl(plugin).length > 0
                          ? html`<button .disabled=${this._pluginBusyKey !== null} @click=${() => this._connectPlugin(plugin)}>
                              ${this._pluginBusyKey === `connect:${plugin.id}`
                                ? "開いています..."
                                : this._pluginAppsNeedingAuth(plugin).length > 0
                                  ? "接続"
                                  : "設定を開く"}
                            </button>`
                          : html``}
                        ${plugin.userInstalled
                          ? html`<button class="btn-danger" .disabled=${this._pluginBusyKey !== null} @click=${() => this._uninstallPlugin(plugin)}>
                              ${this._pluginBusyKey === busyKey ? "削除中..." : "削除"}
                            </button>`
                          : this._pluginAppsWithInstallUrl(plugin).length === 0
                            ? html`<span class="status">—</span>`
                            : html``}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          `}
        ${this._pluginActionStatus ? html`<p class="status">${this._pluginActionStatus}</p>` : ""}
        ${this._pluginListStatus ? html`<p class="status">${this._pluginListStatus}</p>` : ""}
      </section>
    `;
  }

  private _renderSchedules() {
    return html`
      <h3>Schedules</h3>
      <p>現在設定されている cron スケジュールを確認し、不要な予定を削除できます。</p>

      <section class="provider-section active">
        <h4>
          スケジュール一覧
          <button style="margin-left: 10px; font-size: 13px; padding: 4px 10px;" @click=${this._loadSchedules} .disabled=${this._schedulesLoading || this._deletingScheduleId !== null}>
            ${this._schedulesLoading ? "読み込み中..." : "更新"}
          </button>
        </h4>
        ${this._schedulesLoading
          ? html`<p class="status">読み込み中...</p>`
          : this._schedules.length === 0 && !this._scheduleStatus
            ? html`<p class="status">現在有効なスケジュールはありません。</p>`
            : this._schedules.length > 0
              ? html`
                <table class="skills-table">
                  <thead>
                    <tr>
                      <th>Schedule</th>
                      <th>種別</th>
                      <th>次回実行 / 条件</th>
                      <th>通知</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this._schedules.map((schedule) => html`
                      <tr>
                        <td>
                          <div class="schedule-meta">
                            <span class="schedule-title">${schedule.title?.trim() || schedule.id}</span>
                            <span class="schedule-subtle">ID: ${schedule.id}</span>
                            <span class="schedule-subtle">sessionId: ${schedule.sessionId}</span>
                          </div>
                        </td>
                        <td>${schedule.kind === "one_shot" ? "One-shot" : "Recurring"}</td>
                        <td>${this._formatScheduleTiming(schedule)}</td>
                        <td>
                          <div class="schedule-meta">
                            <span>${schedule.notificationMessage}</span>
                            ${schedule.followUpInstruction
                              ? html`<span class="schedule-subtle">follow-up: ${schedule.followUpInstruction}</span>`
                              : html``}
                          </div>
                        </td>
                        <td class="schedule-action">
                          <button
                            class="btn-danger"
                            .disabled=${this._deletingScheduleId !== null}
                            @click=${() => this._deleteSchedule(schedule.id, schedule.title?.trim() || schedule.id)}
                          >${this._deletingScheduleId === schedule.id ? "削除中..." : "削除"}</button>
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              `
              : html``}
        ${this._scheduleStatus ? html`<p class="status">${this._scheduleStatus}</p>` : ""}
      </section>
    `;
  }

  private _renderHeartbeatSection() {
    const status = this._heartbeatStatus;
    const statusMessage = status?.message ?? "状態を取得していません。";
    return html`
      <h3>Heartbeat assistant</h3>
      <p>HEARTBEAT.md を巡回手順書として使い、既定では 30 分ごとに background patrol を実行し、問題がある時だけ表面化します。</p>

      <section class="provider-section active">
        <h4>基本設定</h4>
        <div class="input-grid">
          <label>
            <input
              id="heartbeat-enabled"
              type="checkbox"
              .checked=${this._heartbeatEnabled}
              @change=${(e: InputEvent) => {
                this._heartbeatEnabled = (e.target as HTMLInputElement).checked;
              }}
            />
            heartbeat assistant を有効にする
          </label>
          <label>
            HEARTBEAT.md path
            <input
              id="heartbeat-file-path"
              placeholder="/path/to/HEARTBEAT.md"
              .value=${this._heartbeatFilePath}
              @input=${(e: InputEvent) => {
                this._heartbeatFilePath = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            巡回間隔（分）
            <input
              id="heartbeat-interval-minutes"
              type="number"
              min="1"
              max="1440"
              .value=${String(this._heartbeatIntervalMinutes)}
              @input=${(e: InputEvent) => {
                const next = Number((e.target as HTMLInputElement).value);
                this._heartbeatIntervalMinutes = Number.isFinite(next) ? next : 30;
              }}
            />
          </label>
          <label>
            <input
              id="heartbeat-show-desktop-notifications"
              type="checkbox"
              .checked=${this._heartbeatShowDesktopNotifications}
              @change=${(e: InputEvent) => {
                this._heartbeatShowDesktopNotifications = (e.target as HTMLInputElement).checked;
              }}
            />
            アプリ非フォーカス時に OS 通知も出す
          </label>
        </div>
        <div class="provider-actions">
          <button @click=${this._saveHeartbeatSettings}>Heartbeat 設定を保存</button>
          <button @click=${this._loadHeartbeatStatus}>状態を更新</button>
          <span class="status">${this._heartbeatSaveStatus}</span>
        </div>
      </section>

      <section class="provider-section" style="margin-top: 12px;">
        <h4>状態</h4>
        <p>${statusMessage}</p>
        <div class="status">level: ${status?.level ?? "unknown"}</div>
        ${status?.lastRunAt ? html`<div class="status">lastRunAt: ${status.lastRunAt}</div>` : ""}
        ${status?.lastFindingAt ? html`<div class="status">lastFindingAt: ${status.lastFindingAt}</div>` : ""}
      </section>
    `;
  }

  private _switchTab(tab: "providers" | "chat" | "heartbeat" | "skills" | "plugins" | "schedules") {
    this._activeTab = tab;
    if (tab === "skills" && this._skills.length === 0 && !this._skillsLoading) {
      void this._loadSkills();
    }
    if (tab === "plugins" && this._pluginCatalogs.length === 0 && !this._pluginsLoading) {
      void this._loadPlugins(true);
    }
    if (tab === "heartbeat") {
      void this._loadHeartbeatStatus();
    }
    if (tab === "schedules") {
      void this._loadSchedules();
    }
  }

  private _formatScheduleTiming(schedule: SchedulerScheduleSummary): string {
    if (schedule.nextRunAt) {
      return schedule.nextRunAt;
    }
    if (schedule.kind === "one_shot") {
      return schedule.runAt ?? "未設定";
    }
    return schedule.cronExpr ? `${schedule.cronExpr} (${schedule.timezone})` : `cron 未設定 (${schedule.timezone})`;
  }

  private async _loadSchedules() {
    this._schedulesLoading = true;
    this._scheduleStatus = "";
    try {
      const result = await window.lilto.listSchedules();
      if (result.ok) {
        this._schedules = result.schedules;
      } else {
        this._schedules = [];
        this._scheduleStatus = `一覧取得エラー: ${result.error.code}: ${result.error.message}`;
      }
    } finally {
      this._schedulesLoading = false;
    }
  }

  private async _deleteSchedule(id: string, label: string) {
    const confirmed = globalThis.confirm(`「${label}」を削除しますか？`);
    if (!confirmed) {
      return;
    }

    this._deletingScheduleId = id;
    try {
      const result = await window.lilto.deleteSchedule(id);
      if (!result.ok) {
        this._scheduleStatus = `削除エラー: ${result.error.code}: ${result.error.message}`;
        return;
      }
      await this._loadSchedules();
      this._scheduleStatus = `スケジュール ${id} を削除しました。`;
    } finally {
      this._deletingScheduleId = null;
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

  private _applyPluginState(state: {
    catalogs: PluginCatalogInfo[];
    marketplacePlugins: PluginInfo[];
    installedPlugins: PluginInfo[];
    marketplaceLoadErrors: Array<{ marketplacePath: string; message: string }>;
    remoteSyncError: string | null;
  }) {
    this._pluginCatalogs = state.catalogs;
    this._marketplacePlugins = state.marketplacePlugins;
    this._installedPlugins = state.installedPlugins;
    const notices: string[] = [];
    if (state.remoteSyncError) {
      notices.push(`official curated sync error: ${state.remoteSyncError}`);
    }
    if (state.marketplaceLoadErrors.length > 0) {
      notices.push(
        ...state.marketplaceLoadErrors.map((error) => `${error.marketplacePath}: ${error.message}`)
      );
    }
    this._pluginListStatus = notices.join(" / ");
  }

  private _pluginAppsNeedingAuth(plugin: PluginInfo): PluginAppInfo[] {
    return (this._pluginAppsById[plugin.id] ?? []).filter((app) => app.needsAuth);
  }

  private _pluginAppsWithInstallUrl(plugin: PluginInfo): PluginAppInfo[] {
    return (this._pluginAppsById[plugin.id] ?? []).filter((app) => Boolean(app.installUrl));
  }

  private async _loadPluginDetails(plugins: PluginInfo[]) {
    const entries = await Promise.all(plugins.map(async (plugin) => {
      const result = await window.lilto.readPlugin({
        marketplacePath: plugin.marketplacePath,
        pluginName: plugin.name
      });
      return result.ok ? [plugin.id, result.apps] as const : [plugin.id, []] as const;
    }));

    this._pluginAppsById = Object.fromEntries(entries);
  }

  private async _loadPlugins(forceRemoteSync = true) {
    this._pluginsLoading = true;
    this._pluginListStatus = "";
    try {
      const result = await window.lilto.listPlugins({ forceRemoteSync });
      if (result.ok) {
        this._applyPluginState(result.state);
        await this._loadPluginDetails(result.state.installedPlugins);
      } else {
        if (result.state) {
          this._applyPluginState(result.state);
          await this._loadPluginDetails(result.state.installedPlugins);
        }
        this._pluginListStatus = `一覧取得エラー: ${result.error.code}: ${result.error.message}`;
      }
    } finally {
      this._pluginsLoading = false;
    }
  }

  private async _installPlugin(plugin: PluginInfo) {
    this._pluginBusyKey = `install:${plugin.id}`;
    this._pluginActionStatus = "";
    try {
      const result = await window.lilto.installPlugin({
        marketplacePath: plugin.marketplacePath,
        pluginName: plugin.name,
        sourceKind: plugin.sourceKind
      });
      if (result.ok) {
        this._applyPluginState(result.state);
        await this._loadPluginDetails(result.state.installedPlugins);
        this._pluginActionStatus = result.message ?? `${plugin.displayName} をインストールしました。`;
      } else {
        if (result.state) {
          this._applyPluginState(result.state);
          await this._loadPluginDetails(result.state.installedPlugins);
        }
        this._pluginActionStatus = result.error.code === "PLUGIN_AUTH_REQUIRED"
          ? result.error.message
          : `インストールエラー: ${result.error.code}: ${result.error.message}`;
      }
    } finally {
      this._pluginBusyKey = null;
    }
  }

  private async _connectPlugin(plugin: PluginInfo) {
    const appsWithInstallUrl = this._pluginAppsWithInstallUrl(plugin);
    if (appsWithInstallUrl.length === 0) {
      this._pluginActionStatus = `${plugin.displayName} の接続または設定ページを取得できませんでした。`;
      return;
    }

    const app = this._pluginAppsNeedingAuth(plugin).find((candidate) => candidate.installUrl) ?? appsWithInstallUrl[0];
    if (!app.installUrl) {
      this._pluginActionStatus = `${plugin.displayName} は接続が必要ですが、接続 URL を取得できませんでした。`;
      return;
    }

    this._pluginBusyKey = `connect:${plugin.id}`;
    this._pluginActionStatus = "";
    try {
      const result = await window.lilto.openExternalUrl(app.installUrl);
      this._pluginActionStatus = result.ok
        ? this._pluginAppsNeedingAuth(plugin).length > 0
          ? `${app.name} の接続ページを開きました。承認後に「更新」で状態を再取得してください。`
          : `${app.name} の設定ページを開きました。必要なら接続状態を確認してから「更新」を押してください。`
        : `接続ページを開けませんでした: ${result.error.code}: ${result.error.message}`;
    } finally {
      this._pluginBusyKey = null;
    }
  }

  private async _uninstallPlugin(plugin: PluginInfo) {
    const confirmed = globalThis.confirm(`「${plugin.displayName}」を削除しますか？`);
    if (!confirmed) {
      return;
    }

    this._pluginBusyKey = `uninstall:${plugin.id}`;
    this._pluginActionStatus = "";
    try {
      const result = await window.lilto.uninstallPlugin({
        pluginId: plugin.id,
        sourceKind: plugin.sourceKind
      });
      if (result.ok) {
        this._applyPluginState(result.state);
        await this._loadPluginDetails(result.state.installedPlugins);
        this._pluginActionStatus = result.message ?? `${plugin.displayName} を削除しました。`;
      } else {
        if (result.state) {
          this._applyPluginState(result.state);
          await this._loadPluginDetails(result.state.installedPlugins);
        }
        this._pluginActionStatus = `削除エラー: ${result.error.code}: ${result.error.message}`;
      }
    } finally {
      this._pluginBusyKey = null;
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

  private async _loadHeartbeatStatus() {
    this._heartbeatStatus = await window.lilto.getHeartbeatStatus();
  }

  private async _saveHeartbeatSettings() {
    const intervalMinutes = Math.max(1, Math.min(1440, Math.round(this._heartbeatIntervalMinutes || 30)));
    this._heartbeatIntervalMinutes = intervalMinutes;
    const next: ProviderSettings = {
      ...this.providerSettings,
      heartbeatSettings: {
        enabled: this._heartbeatEnabled,
        filePath: this._heartbeatFilePath.trim(),
        intervalMinutes,
        showDesktopNotifications: this._heartbeatShowDesktopNotifications
      }
    };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._heartbeatSaveStatus = "Heartbeat 設定を保存しました。";
      this._emitProviderSettingsChanged(result.state, { preserveWindowsSandboxStatus: true });
      await this._loadHeartbeatStatus();
      return;
    }
    this._heartbeatSaveStatus = `${result.error.code}: ${result.error.message}`;
  }

  private _describeWindowsSandboxStatus(): string {
    if (!this._isWindows) {
      return "Windows sandbox は Windows でのみ利用できます。";
    }
    if (this._windowsSandboxMode === "off") {
      return "Windows sandbox は無効です。";
    }
    return "設定済みです。保存するとセットアップを実行し、完了後に利用可能か判定します。";
  }

  private _buildProviderSettingsDraft(): ProviderSettings {
    return {
      ...this.providerSettings,
      oauthProvider: this._oauthProvider,
      oauthModelId: this._oauthModelId.trim() || "gpt-5.3-codex",
      customProvider: {
        name: this._customName.trim(),
        baseUrl: this._customBaseUrl.trim(),
        apiKey: this._customApiKey,
        modelId: this._customModelId.trim() || "gpt-5.3-codex"
      },
      networkProxy: {
        useProxy: this._useProxy
      },
      windowsSandbox: {
        mode: this._windowsSandboxMode,
        privateDesktop: this._windowsSandboxPrivateDesktop
      },
      heartbeatSettings: {
        enabled: this._heartbeatEnabled,
        filePath: this._heartbeatFilePath.trim(),
        intervalMinutes: Math.max(1, Math.min(1440, Math.round(this._heartbeatIntervalMinutes || 30))),
        showDesktopNotifications: this._heartbeatShowDesktopNotifications
      }
    };
  }

  private _emitProviderSettingsChanged(state: ProviderSettings, options: { preserveWindowsSandboxStatus?: boolean } = {}) {
    if (options.preserveWindowsSandboxStatus) {
      this._preserveWindowsSandboxStatusOnce = true;
    }
    this.dispatchEvent(
      new CustomEvent("provider-settings-changed", {
        detail: state,
        bubbles: true,
        composed: true
      })
    );
  }

  private async _finalizeWindowsSandboxSave(
    savedState: ProviderSettings,
    options: {
      forceSetup?: boolean;
      onStatus: (message: string) => void;
    }
  ): Promise<ProviderSettings> {
    if (!this._isWindows || savedState.windowsSandbox.mode === "off") {
      this._windowsSandboxStatus = savedState.windowsSandbox.mode === "off"
        ? "Windows sandbox は無効です。"
        : this._describeWindowsSandboxStatus();
      return savedState;
    }

    const previousMode = this.providerSettings.windowsSandbox?.mode ?? "off";
    const shouldRunSetup = options.forceSetup || previousMode !== savedState.windowsSandbox.mode;
    if (!shouldRunSetup) {
      this._windowsSandboxStatus = "設定は保存済みです。必要ならこのセクションの保存でセットアップを再実行できます。";
      return savedState;
    }

    this._windowsSandboxBusy = true;
    this._windowsSandboxStatus = `${savedState.windowsSandbox.mode} モードのセットアップを実行しています...`;

    try {
      const result = await window.lilto.setupWindowsSandbox({ mode: savedState.windowsSandbox.mode });
      if (result.ok) {
        this._windowsSandboxStatus = result.message;
        options.onStatus("設定を保存し、Windows sandbox のセットアップを完了しました。");
        return savedState;
      }

      const fallbackResult = await window.lilto.saveProviderSettings({
        ...savedState,
        windowsSandbox: {
          ...savedState.windowsSandbox,
          mode: "off"
        }
      });
      if (!fallbackResult.ok) {
        const message = `${result.error.code}: ${result.error.message}`;
        this._windowsSandboxStatus = `${message} / fallback 保存にも失敗しました。`;
        options.onStatus(this._windowsSandboxStatus);
        return savedState;
      }

      this._windowsSandboxMode = "off";
      this._windowsSandboxStatus = `${result.error.message} 失敗したため mode を off に戻しました。`;
      options.onStatus(this._windowsSandboxStatus);
      return fallbackResult.state;
    } finally {
      this._windowsSandboxBusy = false;
    }
  }


  private async _changeProvider(provider: ActiveProvider) {
    const next: ProviderSettings = {
      ...this.providerSettings,
      activeProvider: provider,
      oauthProvider: this._oauthProvider,
      oauthModelId: this._oauthModelId.trim() || "gpt-5.3-codex",
      customProvider: {
        ...this.providerSettings.customProvider,
        modelId: this._customModelId.trim() || "gpt-5.3-codex"
      }
    };
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      this._providerSelStatus = provider === "oauth" ? "現在: ChatGPT Login" : "現在: API Key";
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
    if (this.providerSettings.activeProvider === "custom-openai-completions" && !this._customApiKey.trim()) {
      this._saveStatus = "API key は必須です。";
      return;
    }
    this._saveStatus = "";
    const next = this._buildProviderSettingsDraft();
    const result = await window.lilto.saveProviderSettings(next);
    if (result.ok) {
      const finalState = await this._finalizeWindowsSandboxSave(result.state, {
        onStatus: (message) => {
          this._saveStatus = message;
        }
      });
      if (!this._saveStatus) {
        this._saveStatus = "設定を保存しました。";
      }
      this._emitProviderSettingsChanged(finalState, { preserveWindowsSandboxStatus: true });
    } else {
      this._saveStatus = `${result.error.code}: ${result.error.message}`;
    }
  }

  private async _startOauth() {
    const saveResult = await window.lilto.saveProviderSettings({
      ...this.providerSettings,
      oauthProvider: this._oauthProvider,
      oauthModelId: this._oauthModelId.trim() || "gpt-5.3-codex",
      customProvider: {
        ...this.providerSettings.customProvider,
        modelId: this._customModelId.trim() || "gpt-5.3-codex"
      }
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

  private async _saveOauthSettings() {
    this._oauthSaveStatus = "";
    const result = await window.lilto.saveProviderSettings(this._buildProviderSettingsDraft());
    if (!result.ok) {
      this._oauthSaveStatus = `${result.error.code}: ${result.error.message}`;
      return;
    }
    const finalState = await this._finalizeWindowsSandboxSave(result.state, {
      onStatus: (message) => {
        this._oauthSaveStatus = message;
      }
    });
    if (!this._oauthSaveStatus) {
      this._oauthSaveStatus = "Model 設定を保存しました。";
    }
    this._emitProviderSettingsChanged(finalState, { preserveWindowsSandboxStatus: true });
  }

  private async _saveWindowsSandboxSettings() {
    this._windowsSandboxStatus = this._describeWindowsSandboxStatus();
    const result = await window.lilto.saveProviderSettings(this._buildProviderSettingsDraft());
    if (!result.ok) {
      this._windowsSandboxStatus = `${result.error.code}: ${result.error.message}`;
      return;
    }
    const finalState = await this._finalizeWindowsSandboxSave(result.state, {
      forceSetup: result.state.windowsSandbox.mode !== "off",
      onStatus: (message) => {
        this._windowsSandboxStatus = message;
      }
    });
    this._emitProviderSettingsChanged(finalState, { preserveWindowsSandboxStatus: true });
  }

  private async _loadOauthModels() {
    this._oauthModelsLoading = true;
    this._oauthModelsStatus = "";
    try {
      const result = await window.lilto.listModels({
        mode: "oauth",
        oauthProvider: this._oauthProvider,
        networkProxy: { useProxy: this._useProxy }
      });
      if (!result.ok) {
        this._oauthModels = [];
        this._oauthModelsStatus = `${result.error.code}: ${result.error.message}`;
        return;
      }
      this._oauthModels = result.models;
      if (!this._oauthModelId.trim() && result.models[0]) {
        this._oauthModelId = result.models[0].id;
      }
      this._oauthModelsStatus = result.models.length > 0 ? `${result.models.length} 件取得しました。` : "利用可能なモデルがありません。";
    } finally {
      this._oauthModelsLoading = false;
    }
  }

  private async _loadCustomModels() {
    this._customModelsLoading = true;
    this._customModelsStatus = "";
    try {
      const result = await window.lilto.listModels({
        mode: "custom-openai-completions",
        customProvider: {
          name: this._customName.trim(),
          baseUrl: this._customBaseUrl.trim(),
          apiKey: this._customApiKey,
          modelId: this._customModelId.trim()
        },
        networkProxy: { useProxy: this._useProxy }
      });
      if (!result.ok) {
        this._customModels = [];
        this._customModelsStatus = `${result.error.code}: ${result.error.message}`;
        return;
      }
      this._customModels = result.models;
      if (!this._customModelId.trim() && result.models[0]) {
        this._customModelId = result.models[0].id;
      }
      this._customModelsStatus = result.models.length > 0 ? `${result.models.length} 件取得しました。` : "利用可能なモデルがありません。";
    } finally {
      this._customModelsLoading = false;
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
