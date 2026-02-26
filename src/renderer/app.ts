import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { AuthState, ProviderSettings, Message } from "./types.js";
import type { OAuthProviderId } from "../shared/provider-settings.js";
import "./components/top-bar.js";
import "./components/message-list.js";
import "./components/composer.js";
import "./components/settings-modal.js";
import type { LiltComposer } from "./components/composer.js";
import type { AgentLoopEvent, LoopState } from "../shared/agent-loop.js";
import { createInitialLoopState, reduceLoopState } from "../shared/agent-loop.js";

@customElement("lilt-app")
export class LiltApp extends LitElement {
  @property({ type: Object }) authState: AuthState | null = null;
  @property({ type: Object }) providerSettings: ProviderSettings = {
    activeProvider: "claude",
    oauthProvider: "anthropic",
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
  @property({ type: Array }) messages: Message[] = [];
  @property({ type: Boolean }) isSending = false;
  @property({ type: Boolean }) settingsOpen = false;
  @property({ type: Object }) loopState: LoopState = createInitialLoopState();

  @query("lilt-composer") private _composer!: LiltComposer;

  private _unsubscribeAuthListener: (() => void) | null = null;
  private _unsubscribeLoopListener: (() => void) | null = null;
  private _pendingAssistantIndex: number | null = null;
  private _progressLines: string[] = [];

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
    this._unsubscribeLoopListener = window.lilto.onAgentLoopEvent((event) => {
      this._onLoopEvent(event);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeAuthListener?.();
    this._unsubscribeLoopListener?.();
    this._unsubscribeAuthListener = null;
    this._unsubscribeLoopListener = null;
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
      return (
        this.authState?.phase === "authenticated" &&
        this.authState?.provider === this.providerSettings.oauthProvider
      );
    }
    const cp = this.providerSettings.customProvider;
    return Boolean(cp.name.trim() && cp.baseUrl.trim());
  }

  private _statusText(): string {
    if (this.isSending || this.loopState.status === "running") {
      if (this.loopState.activeTools.length > 0) {
        return `ツール実行中 (${this.loopState.activeTools.length})`;
      }
      return "送信中...";
    }
    if (this.loopState.status === "failed") return "実行失敗";
    if (this._canSend()) return "待機中";
    return "プロバイダー設定が必要";
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

  private _syncSendability() {
    // Triggers re-render by updating isSending (no-op needed; reactive props handle it)
    this.requestUpdate();
  }

  render() {
    return html`
      <lilt-top-bar
        statusText=${this._statusText()}
        .newSessionDisabled=${this.isSending}
        @new-session=${this._onStartNewSession}
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

  private _onStartNewSession() {
    if (this.isSending) return;
    this.messages = [];
    this.loopState = createInitialLoopState();
    this._pendingAssistantIndex = null;
    this._progressLines = [];
  }

  private async _onSendMessage(e: CustomEvent<{ text: string }>) {
    const text = e.detail.text;
    if (!this._canSend() || !text) {
      if (!this._canSend()) {
        this._addMessage("system",
          this.providerSettings.activeProvider === "claude"
            ? "プロバイダー設定が必要です。Settings から OAuth Provider を設定してください。"
            : "Custom Provider の name / baseUrl を設定して保存してから送信してください。"
        );
        this.settingsOpen = true;
      }
      return;
    }

    this._addMessage("user", text);
    const pendingIdx = this._addPendingMessage("assistant", "実行開始を待っています...");
    this._pendingAssistantIndex = pendingIdx;
    this._progressLines = [];
    this.loopState = {
      ...createInitialLoopState(),
      status: "running"
    };
    this.isSending = true;

    try {
      const result = await window.lilto.submitPrompt(text);
      if (result.ok) {
        const prefix = this._progressLines.length > 0 ? `${this._progressLines.join("\n")}\n\n` : "";
        this._resolvePendingMessage(pendingIdx, `${prefix}${result.response.text}`);
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
      this._pendingAssistantIndex = null;
      this._progressLines = [];
    }
  }

  private _onLoopEvent(event: AgentLoopEvent) {
    this.loopState = reduceLoopState(this.loopState, event);
    this._appendProgressLineFromLoopEvent(event);
  }

  private _appendProgressLineFromLoopEvent(event: AgentLoopEvent) {
    if (this._pendingAssistantIndex === null) return;

    let lines: string[] = [];
    switch (event.type) {
      case "run_start":
        lines = ["実行を開始しました"];
        break;
      case "thinking_start":
        lines = ["考え中..."];
        break;
      case "thinking_end":
        lines = [];
        break;
      case "tool_execution_start":
        lines = [`ツール開始: ${event.toolName}`];
        {
          const detail = this._formatToolArgs(event.args);
          if (detail) lines.push(`  詳細: ${detail}`);
        }
        break;
      case "tool_execution_end":
        lines = [];
        break;
      case "run_end":
        lines = event.status === "failed" || event.status === "aborted"
          ? [`実行失敗: ${event.errorMessage ?? "不明なエラー"}`]
          : [];
        break;
      default:
        lines = [];
    }

    if (lines.length === 0) return;
    this._progressLines = [...this._progressLines, ...lines];
    this._updatePendingMessageText(this._pendingAssistantIndex, this._progressLines.join("\n"));
  }

  private _formatToolArgs(args: unknown): string {
    if (!args || typeof args !== "object") return "";
    const argRecord = args as Record<string, unknown>;
    const summaryCandidates = ["command", "query", "path", "url", "pattern", "tool", "fn"];
    for (const key of summaryCandidates) {
      const value = argRecord[key];
      if (typeof value === "string" && value.trim()) {
        return `${key}=${value}`;
      }
    }
    const preview = JSON.stringify(argRecord);
    if (!preview || preview === "{}") return "";
    return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
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

  private _updatePendingMessageText(idx: number, text: string) {
    this.messages = this.messages.map((m, i) =>
      i === idx ? { ...m, text, pending: true } : m
    );
  }

  private _removePendingMessage(idx: number) {
    this.messages = this.messages.filter((_, i) => i !== idx);
  }
}
