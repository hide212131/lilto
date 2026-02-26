import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { AuthState, ProviderSettings, Message, AssistantProgress, AssistantToolProgress } from "./types.js";
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
    customProvider: {
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      modelId: "qwen2.5:0.5b"
    },
    networkProxy: {
      useProxy: false
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
  private _activeRequestId: string | null = null;
  private _messageSeq = 0;
  private _statusLines: string[] = [];
  private _thinkingText = "";
  private _toolProgress: AssistantToolProgress[] = [];

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
      return this.authState?.phase === "authenticated";
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
    this._activeRequestId = null;
    this._statusLines = [];
    this._thinkingText = "";
    this._toolProgress = [];
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
    const pendingIdx = this._addPendingMessage("assistant", "実行開始を待っています...");
    this._pendingAssistantIndex = pendingIdx;
    this._activeRequestId = null;
    this._statusLines = [];
    this._thinkingText = "";
    this._toolProgress = [];
    this.loopState = {
      ...createInitialLoopState(),
      status: "running"
    };
    this.isSending = true;

    try {
      const result = await window.lilto.submitPrompt(text);
      if (result.ok) {
        this._resolvePendingMessage(pendingIdx, result.response.text, this._buildProgress());
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
      this._activeRequestId = null;
      this._statusLines = [];
      this._thinkingText = "";
      this._toolProgress = [];
    }
  }

  private _onLoopEvent(event: AgentLoopEvent) {
    this.loopState = reduceLoopState(this.loopState, event);
    this._appendProgressLineFromLoopEvent(event);
  }

  private _appendProgressLineFromLoopEvent(event: AgentLoopEvent) {
    if (this._pendingAssistantIndex === null) return;

    let changed = false;
    switch (event.type) {
      case "run_start":
        this._activeRequestId = event.requestId;
        this._attachRequestIdToPendingMessage(event.requestId);
        this._statusLines = ["実行を開始しました"];
        changed = true;
        break;
      case "thinking_start":
        if (this._statusLines.length === 0 || this._statusLines[this._statusLines.length - 1] !== "考え中...") {
          this._statusLines = [...this._statusLines, "考え中..."];
          changed = true;
        }
        break;
      case "thinking_delta":
        if (event.delta) {
          this._thinkingText += event.delta;
          changed = true;
        }
        break;
      case "thinking_end":
        changed = false;
        break;
      case "tool_execution_start":
        {
          const newTool: AssistantToolProgress = { toolName: event.toolName };
          const detail = this._formatToolArgs(event.args);
          if (detail) {
            newTool.detail = detail;
          }
          this._toolProgress = [...this._toolProgress, newTool];
          this._statusLines = [...this._statusLines, `コマンド実行: ${event.toolName}`];
          changed = true;
        }
        break;
      case "tool_execution_end":
        changed = false;
        break;
      case "run_end":
        if (event.status === "failed" || event.status === "aborted") {
          this._statusLines = [...this._statusLines, `実行失敗: ${event.errorMessage ?? "不明なエラー"}`];
          changed = true;
        }
        break;
      default:
        changed = false;
    }

    if (!changed) return;

    this._updatePendingMessage(
      this._pendingAssistantIndex,
      this._thinkingText ? "Thinking を表示しています..." : "実行中...",
      this._buildProgress()
    );
  }

  private _buildProgress(): AssistantProgress | undefined {
    const hasStatus = this._statusLines.length > 0;
    const hasThinking = this._thinkingText.trim().length > 0;
    const hasTools = this._toolProgress.length > 0;

    if (!hasStatus && !hasThinking && !hasTools) return undefined;

    return {
      statusLines: [...this._statusLines],
      thinkingText: hasThinking ? this._thinkingText : undefined,
      tools: [...this._toolProgress]
    };
  }

  private _formatToolArgs(args: unknown): string {
    if (!args || typeof args !== "object") return "";
    const argRecord = args as Record<string, unknown>;
    const command = argRecord.command;
    if (typeof command === "string" && command.trim()) {
      return command;
    }
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

  private _addMessage(role: Message["role"], text: string, progress?: AssistantProgress): number {
    const msg: Message = {
      id: this._nextMessageId(),
      requestId: this._activeRequestId ?? undefined,
      role,
      text,
      progress
    };
    this.messages = [...this.messages, msg];
    return this.messages.length - 1;
  }

  private _addPendingMessage(role: Message["role"], text: string, progress?: AssistantProgress): number {
    const msg: Message = {
      id: this._nextMessageId(),
      requestId: this._activeRequestId ?? undefined,
      role,
      text,
      pending: true,
      progress
    };
    this.messages = [...this.messages, msg];
    return this.messages.length - 1;
  }

  private _attachRequestIdToPendingMessage(requestId: string) {
    if (this._pendingAssistantIndex === null) return;
    this.messages = this.messages.map((m, i) =>
      i === this._pendingAssistantIndex ? { ...m, requestId } : m
    );
  }

  private _nextMessageId(): string {
    this._messageSeq += 1;
    return `msg-${this._messageSeq}`;
  }

  private _resolvePendingMessage(idx: number, text: string, progress?: AssistantProgress) {
    this.messages = this.messages.map((m, i) =>
      i === idx ? { ...m, text, pending: false, progress } : m
    );
  }

  private _updatePendingMessage(idx: number, text: string, progress?: AssistantProgress) {
    this.messages = this.messages.map((m, i) =>
      i === idx ? { ...m, text, pending: true, progress } : m
    );
  }

  private _removePendingMessage(idx: number) {
    this.messages = this.messages.filter((_, i) => i !== idx);
  }
}
