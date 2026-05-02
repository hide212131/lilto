import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import {
  buildHeartbeatAssistantSessionTitle,
  heartbeatSessionDateKeyFromSessionId,
  isHeartbeatAssistantSessionId,
  HEARTBEAT_ASSISTANT_SESSION_ID,
  HEARTBEAT_INTERNAL_SCHEDULE_ID
} from "../shared/heartbeat-assistant.js";
import type { AuthState, ProviderSettings, Message, AssistantProgress, AssistantToolProgress, Session } from "./types.js";
import type { OAuthProviderId } from "../shared/provider-settings.js";
import type { SchedulerNotificationEvent } from "../shared/scheduler.js";
import "./components/top-bar.js";
import "./components/message-list.js";
import "./components/composer.js";
import "./components/settings-modal.js";
import "./components/chat-history.js";
import type { LiltComposer } from "./components/composer.js";
import type { AgentLoopEvent, LoopState } from "../shared/agent-loop.js";
import { createInitialLoopState, reduceLoopState } from "../shared/agent-loop.js";

const SESSIONS_STORAGE_KEY = "lilto-sessions";
const SIDEBAR_WIDTH_STORAGE_KEY = "lilto-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;

@customElement("lilt-app")
export class LiltApp extends LitElement {
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
      globalShortcut: "CommandOrControl+L"
    },
    heartbeatSettings: {
      enabled: false,
      filePath: "",
      intervalMinutes: 30,
      showDesktopNotifications: true
    },
    updatedAt: Date.now()
  };
  @property({ type: Array }) messages: Message[] = [];
  @property({ type: Boolean }) isSending = false;
  @property({ type: Boolean }) settingsOpen = false;
  @property({ type: Object }) loopState: LoopState = createInitialLoopState();
  @property({ type: Boolean }) sidebarOpen = false;
  @property({ type: Number }) sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  @property({ type: Array }) sessions: Session[] = [];
  @property() activeSessionId: string | null = null;

  @query(".body") private _body!: HTMLDivElement;
  @query("lilt-composer") private _composer!: LiltComposer;

  private _unsubscribeAuthListener: (() => void) | null = null;
  private _unsubscribeLoopListener: (() => void) | null = null;
  private _unsubscribeSchedulerListener: (() => void) | null = null;
  private _unsubscribeFocusListener: (() => void) | null = null;
  private _pendingAssistantIndex: number | null = null;
  private _activeRequestId: string | null = null;
  private _messageSeq = 0;
  private _statusLines: string[] = [];
  private _thinkingText = "";
  private _toolProgress: AssistantToolProgress[] = [];
  private _pendingLabel = "";
  private _currentSessionId: string | null = null;
  private _isResizingSidebar = false;
  private _onSidebarResize = (event: PointerEvent) => {
    if (!this._isResizingSidebar) return;
    const nextWidth = this._clampSidebarWidth(event.clientX - this._body.getBoundingClientRect().left);
    if (nextWidth === this.sidebarWidth) return;
    this.sidebarWidth = nextWidth;
  };
  private _stopSidebarResize = () => {
    if (!this._isResizingSidebar) return;
    this._isResizingSidebar = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", this._onSidebarResize);
    window.removeEventListener("pointerup", this._stopSidebarResize);
    this._saveSidebarWidth();
  };

  private _getActiveSession(): Session | null {
    if (!this._currentSessionId) {
      return null;
    }
    return this.sessions.find((session) => session.id === this._currentSessionId) ?? null;
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      background: var(--bg, #f3f3f4);
      color: var(--text, #1f2328);
    }
    .body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }
    lilt-chat-history {
      flex-shrink: 0;
      transition: width 0.2s ease, min-width 0.2s ease;
    }
    .body.resizing lilt-chat-history {
      transition: none;
    }
    lilt-chat-history[hidden] {
      display: none;
    }
    .sidebar-resizer {
      flex: 0 0 10px;
      align-self: stretch;
      cursor: col-resize;
      position: relative;
      background: transparent;
      border: 0;
      padding: 0;
      margin: 0 -4px 0 0;
      z-index: 1;
    }
    .sidebar-resizer::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 4px;
      width: 1px;
      background: rgba(31, 35, 40, 0.08);
      transition: background 0.12s ease;
    }
    .sidebar-resizer:hover::before,
    .body.resizing .sidebar-resizer::before {
      background: #d29a00;
    }
    .main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      overflow: hidden;
    }
    .stage {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      margin: 0;
      overflow: hidden;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._loadSessions();
    this._loadSidebarWidth();
    void this._hydrate();
    this._unsubscribeAuthListener = window.lilto.onAuthStateChanged((state) => {
      this.authState = state;
      this._syncSendability();
    });
    this._unsubscribeLoopListener = window.lilto.onAgentLoopEvent((event) => {
      this._onLoopEvent(event);
    });
    this._unsubscribeSchedulerListener = window.lilto.onSchedulerNotification((event) => {
      this._onSchedulerNotification(event);
    });
    this._unsubscribeFocusListener = window.lilto.onFocusComposer(() => {
      void this.updateComplete.then(() => {
        this._composer?.focusInput();
      });
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopSidebarResize();
    this._unsubscribeAuthListener?.();
    this._unsubscribeLoopListener?.();
    this._unsubscribeSchedulerListener?.();
    this._unsubscribeFocusListener?.();
    this._unsubscribeAuthListener = null;
    this._unsubscribeLoopListener = null;
    this._unsubscribeSchedulerListener = null;
    this._unsubscribeFocusListener = null;
  }

  private _loadSessions() {
    try {
      const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
      if (raw) {
        this.sessions = JSON.parse(raw) as Session[];
      }
    } catch {
      this.sessions = [];
    }
  }

  private _saveSessions() {
    try {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(this.sessions));
    } catch {
      // ストレージ容量超過などは無視
    }
  }

  private _loadSidebarWidth() {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (!raw) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      this.sidebarWidth = this._clampSidebarWidth(parsed);
    } catch {
      this.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
    }
  }

  private _saveSidebarWidth() {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(this.sidebarWidth));
    } catch {
      // ストレージ容量超過などは無視
    }
  }

  private _clampSidebarWidth(width: number) {
    const maxWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 320));
    return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxWidth);
  }

  private _saveCurrentSession() {
    const userMessages = this.messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (userMessages.length === 0) return;

    const existingSession = this._currentSessionId
      ? this.sessions.find((session) => session.id === this._currentSessionId)
      : null;
    const firstUser = this.messages.find((m) => m.role === "user");
    const title = firstUser
      ? firstUser.text.slice(0, 40) + (firstUser.text.length > 40 ? "…" : "")
      : existingSession?.title ?? "会話";

    if (this._currentSessionId) {
      // 既存セッションを更新
      this.sessions = this.sessions.map((s) =>
        s.id === this._currentSessionId
          ? { ...s, title, messages: [...this.messages] }
          : s
      );
    } else {
      // 新しいセッションを追加
      const newSession: Session = {
        id: `session-${Date.now()}`,
        title,
        createdAt: Date.now(),
        messages: [...this.messages]
      };
      this._currentSessionId = newSession.id;
      this.activeSessionId = newSession.id;
      // 最新が上に来るよう先頭に追加
      this.sessions = [newSession, ...this.sessions];
    }
    this._saveSessions();
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
    if (this.providerSettings.activeProvider === "oauth") {
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
      case "openai-codex":
        return "OpenAI Codex";
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
        .sidebarOpen=${this.sidebarOpen}
        @new-session=${this._onStartNewSession}
        @open-settings=${() => { this.settingsOpen = true; }}
        @toggle-sidebar=${this._onToggleSidebar}
      ></lilt-top-bar>

      <div class="body ${this._isResizingSidebar ? "resizing" : ""}">
        <lilt-chat-history
          ?hidden=${!this.sidebarOpen}
          style=${this.sidebarOpen ? `width: ${this.sidebarWidth}px; min-width: ${this.sidebarWidth}px;` : ""}
          .sessions=${this.sessions}
          .activeSessionId=${this.activeSessionId}
          @select-session=${this._onSelectSession}
          @rename-session=${this._onRenameSession}
          @delete-session=${this._onDeleteSession}
        ></lilt-chat-history>
        ${this.sidebarOpen ? html`
          <button
            class="sidebar-resizer"
            type="button"
            title="サイドパネル幅を変更"
            aria-label="サイドパネル幅を変更"
            @pointerdown=${this._onSidebarResizeStart}
          ></button>
        ` : ""}

        <div class="main">
          <div class="stage">
            <lilt-message-list
              .messages=${this.messages}
              @retry-message=${this._onRetryMessage}
            ></lilt-message-list>
            <lilt-composer
              .disabled=${!this._canSend()}
              .isSending=${this.isSending}
              .enterToSend=${this.providerSettings.chatSettings?.enterToSend ?? false}
              @send-message=${this._onSendMessage}
              @abort-request=${this._onAbortRequest}
            ></lilt-composer>
          </div>
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

  private _onToggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  private _onSidebarResizeStart(event: PointerEvent) {
    if (!this.sidebarOpen) return;
    event.preventDefault();
    this._isResizingSidebar = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", this._onSidebarResize);
    window.addEventListener("pointerup", this._stopSidebarResize);
  }

  private _onSelectSession(e: CustomEvent<Session>) {
    const session = e.detail;
    if (session.id === this._currentSessionId) return;
    // 現在のセッションを保存してから切り替え
    this._saveCurrentSession();
    this.messages = [...session.messages];
    this._currentSessionId = session.id;
    this.activeSessionId = session.id;
    this.loopState = createInitialLoopState();
    this._pendingAssistantIndex = null;
    this._activeRequestId = null;
    this._statusLines = [];
    this._thinkingText = "";
    this._toolProgress = [];
    this._pendingLabel = "";
  }

  private _onRenameSession(e: CustomEvent<{ sessionId: string; newTitle: string }>) {
    const { sessionId, newTitle } = e.detail;
    this.sessions = this.sessions.map((s) =>
      s.id === sessionId ? { ...s, title: newTitle } : s
    );
    this._saveSessions();
  }

  private _onDeleteSession(e: CustomEvent<{ sessionId: string }>) {
    const { sessionId } = e.detail;
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    this._saveSessions();
    if (sessionId === this._currentSessionId) {
      this.messages = [];
      this.loopState = createInitialLoopState();
      this._currentSessionId = null;
      this.activeSessionId = null;
    }
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
    this._saveCurrentSession();
    this.messages = [];
    this.loopState = createInitialLoopState();
    this._pendingAssistantIndex = null;
    this._activeRequestId = null;
    this._statusLines = [];
    this._thinkingText = "";
    this._toolProgress = [];
    this._pendingLabel = "";
    this._currentSessionId = null;
    this.activeSessionId = null;
  }

  private _onAbortRequest() {
    void window.lilto.abortPrompt();
  }

  private async _doSend(text: string) {
    const pendingIdx = this._addPendingMessage("assistant", "実行開始を待っています...");
    this._pendingAssistantIndex = pendingIdx;
    this._activeRequestId = null;
    this._statusLines = [];
    this._thinkingText = "";
    this._toolProgress = [];
    this._pendingLabel = "";
    this.loopState = {
      ...createInitialLoopState(),
      status: "running"
    };
    this.isSending = true;

    try {
      const activeSession = this._getActiveSession();
      const result = await window.lilto.submitPrompt(
        text,
        this._currentSessionId,
        activeSession?.backendSessionId ?? null
      );
      if (result.ok) {
        this._resolvePendingMessage(pendingIdx, result.response.text, this._buildProgress());
        this._saveCurrentSession();
        await this.updateComplete;
        this._composer?.focusInput();
        return;
      }
      const error = result.error ?? { code: "UNKNOWN", message: "不明なエラー" };
      if (error.code === "ABORTED") {
        this._resolvePendingMessage(pendingIdx, "", this._buildProgress());
      } else {
        this._removePendingMessage(pendingIdx);
        this._addMessage("error", `${error.code}: ${error.message}`);
        if (
          error.code === "AUTH_REQUIRED" ||
          error.code === "PROVIDER_CONFIG_REQUIRED" ||
          error.code === "WINDOWS_SANDBOX_SETUP_REQUIRED" ||
          error.code === "WINDOWS_SANDBOX_SETUP_FAILED" ||
          error.code === "WINDOWS_SANDBOX_UNSUPPORTED_MODE"
        ) {
          this.settingsOpen = true;
        }
      }
      this._saveCurrentSession();
    } catch (err) {
      this._removePendingMessage(pendingIdx);
      this._addMessage("error", `UNEXPECTED: ${String(err)}`);
      this._saveCurrentSession();
    } finally {
      this.isSending = false;
      this._pendingAssistantIndex = null;
      this._activeRequestId = null;
      this._statusLines = [];
      this._thinkingText = "";
      this._toolProgress = [];
      this._pendingLabel = "";
    }
  }

  private async _onSendMessage(e: CustomEvent<{ text: string }>) {
    const text = e.detail.text;
    if (!this._canSend() || !text) {
      if (!this._canSend()) {
        this._addMessage("system",
          this.providerSettings.activeProvider === "oauth"
            ? "Codex ChatGPT 認証が必要です。Settings から認証を開始してください。"
            : "API key を設定して保存してから送信してください。"
        );
        this.settingsOpen = true;
      }
      return;
    }

    this._addMessage("user", text);
    this._saveCurrentSession();
    await this._doSend(text);
  }

  private async _onRetryMessage(e: CustomEvent<{ messageId: string; text: string }>) {
    if (!this._canSend()) return;
    const { messageId, text } = e.detail;
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    // Remove all messages from idx+1 onwards (clears the assistant response and any subsequent messages)
    this.messages = this.messages.slice(0, idx + 1);
    this._saveCurrentSession();
    await this._doSend(text);
  }

  private _onLoopEvent(event: AgentLoopEvent) {
    this.loopState = reduceLoopState(this.loopState, event);
    if (event.type === "session_bound" && event.conversationId) {
      this._bindBackendSession(event.conversationId, event.agentSessionId);
    }
    this._appendProgressLineFromLoopEvent(event);
  }

  private _onSchedulerNotification(event: SchedulerNotificationEvent) {
    if (event.id === HEARTBEAT_INTERNAL_SCHEDULE_ID || isHeartbeatAssistantSessionId(event.sessionId)) {
      const heartbeatSessionId = this._ensureHeartbeatSession(event.sessionId);
      this._appendMessageToSession(heartbeatSessionId, {
        id: this._nextMessageId(),
        role: "assistant",
        text: event.message
      });
      return;
    }

    const targetSession = this.sessions.find((session) =>
      session.backendSessionId === event.sessionId || session.id === event.sessionId
    );
    if (!targetSession) {
      return;
    }

    const notificationText = event.followUpInstruction
      ? `${event.message}\n続きの処理: ${event.followUpInstruction}`
      : event.message;
    this._appendMessageToSession(targetSession.id, {
      id: this._nextMessageId(),
      role: "system",
      text: notificationText
    });

    if (event.followUpInstruction) {
      void this._runSchedulerFollowUp(targetSession.id, event);
    }
  }

  private async _runSchedulerFollowUp(conversationId: string, event: SchedulerNotificationEvent) {
    const pendingMessageId = this._appendMessageToSession(conversationId, {
      id: this._nextMessageId(),
      role: "assistant",
      text: "スケジュールに続く処理を実行中...",
      pending: true
    });

    try {
      const session = this.sessions.find((entry) => entry.id === conversationId) ?? null;
      const result = await window.lilto.submitPrompt(
        this._buildSchedulerFollowUpPrompt(event),
        conversationId,
        session?.backendSessionId ?? null
      );
      if (result.ok) {
        this._updateSessionMessage(conversationId, pendingMessageId, {
          text: result.response.text,
          pending: false
        });
        return;
      }

      const error = result.error ?? { code: "UNKNOWN", message: "不明なエラー" };
      this._updateSessionMessage(conversationId, pendingMessageId, {
        role: "error",
        text: `${error.code}: ${error.message}`,
        pending: false
      });
    } catch (error) {
      this._updateSessionMessage(conversationId, pendingMessageId, {
        role: "error",
        text: `UNEXPECTED: ${String(error)}`,
        pending: false
      });
    }
  }

  private _buildSchedulerFollowUpPrompt(event: SchedulerNotificationEvent): string {
    return [
      "以下はこの会話で発火した scheduler 通知です。",
      `通知文言: ${event.message}`,
      `続きの処理: ${event.followUpInstruction ?? ""}`,
      "通知文言はすでにユーザーへ表示されています。",
      "まず必要なら一言だけ何をするかを伝え、その後に続きの処理をこの会話で実行してください。"
    ].join("\n");
  }

  private _appendProgressLineFromLoopEvent(event: AgentLoopEvent) {
    if (this._pendingAssistantIndex === null) return;

    let changed = false;
    switch (event.type) {
      case "run_start":
        this._activeRequestId = event.requestId;
        this._attachRequestIdToPendingMessage(event.requestId);
        changed = true;
        break;
      case "session_bound":
        changed = false;
        break;
      case "thinking_start":
        if (this._statusLines.length === 0 || this._statusLines[this._statusLines.length - 1] !== "考え中...") {
          this._statusLines = [...this._statusLines, "考え中..."];
          changed = true;
        }
        break;
      case "thinking_delta":
        if (event.delta) {
          this._pendingLabel += event.delta;
          changed = true;
        }
        break;
      case "thinking_end":
        {
          const nextStatusLines = this._statusLines.filter((line) => line !== "考え中...");
          if (nextStatusLines.length !== this._statusLines.length) {
            this._statusLines = nextStatusLines;
            changed = true;
          } else {
            changed = false;
          }
        }
        break;
      case "text_delta":
        if (event.delta) {
          this._pendingLabel += event.delta;
          changed = true;
        }
        break;
      case "tool_execution_start":
        {
          const newTool: AssistantToolProgress = { toolName: event.toolName };
          const detail = this._formatToolArgs(event.args);
          if (detail) {
            newTool.detail = detail;
          }
          const label = this._pendingLabel.trim();
          if (label) {
            newTool.label = label;
          }
          this._pendingLabel = "";
          this._toolProgress = [...this._toolProgress, newTool];
          changed = true;
        }
        break;
      case "tool_execution_end":
        changed = false;
        break;
      case "run_end":
        if (event.status === "aborted") {
          this._statusLines = [...this._statusLines, "中断しました"];
          changed = true;
        } else if (event.status === "failed") {
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
      "実行中...",
      this._buildProgress()
    );
  }

  private _buildProgress(): AssistantProgress | undefined {
    const hasStatus = this._statusLines.length > 0;
    const hasThinking = this._thinkingText.trim().length > 0;
    const hasTools = this._toolProgress.length > 0;
    const hasPendingLabel = this._pendingLabel.trim().length > 0;

    if (!hasStatus && !hasThinking && !hasTools && !hasPendingLabel) return undefined;

    return {
      statusLines: [...this._statusLines],
      thinkingText: hasThinking ? this._thinkingText : undefined,
      tools: [...this._toolProgress],
      pendingLabel: hasPendingLabel ? this._pendingLabel : undefined
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

  private _appendMessageToSession(sessionId: string, message: Message): string {
    this.sessions = this.sessions.map((session) =>
      session.id === sessionId
        ? { ...session, messages: [...session.messages, message] }
        : session
    );

    if (this._currentSessionId === sessionId) {
      this.messages = [...this.messages, message];
    }

    this._saveSessions();
    return message.id;
  }

  private _updateSessionMessage(sessionId: string, messageId: string, patch: Partial<Message>) {
    this.sessions = this.sessions.map((session) =>
      session.id === sessionId
        ? {
          ...session,
          messages: session.messages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          )
        }
        : session
    );

    if (this._currentSessionId === sessionId) {
      this.messages = this.messages.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message
      );
    }

    this._saveSessions();
  }

  private _bindBackendSession(conversationId: string, backendSessionId: string) {
    let updated = false;
    this.sessions = this.sessions.map((session) => {
      if (session.id !== conversationId || session.backendSessionId === backendSessionId) {
        return session;
      }
      updated = true;
      return { ...session, backendSessionId };
    });
    if (updated) {
      this._saveSessions();
    }
  }

  private _ensureHeartbeatSession(requestedSessionId?: string): string {
    const sessionId =
      requestedSessionId && isHeartbeatAssistantSessionId(requestedSessionId)
        ? requestedSessionId
        : HEARTBEAT_ASSISTANT_SESSION_ID;
    const existing = this.sessions.find((session) => session.id === sessionId);
    if (existing) {
      return existing.id;
    }

    const dateKey = heartbeatSessionDateKeyFromSessionId(sessionId);

    const session: Session = {
      id: sessionId,
      title: dateKey ? buildHeartbeatAssistantSessionTitle(dateKey) : "Heartbeat assistant",
      createdAt: Date.now(),
      messages: []
    };
    this.sessions = [session, ...this.sessions];
    this._saveSessions();
    return session.id;
  }
}
