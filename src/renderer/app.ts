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
import {
  buildConditionalSchedulerFollowUpPrompt,
  parseSchedulerNotificationDecision,
  shouldRunConditionalSchedulerFollowUp
} from "../shared/scheduler-follow-up.js";
import type { SchedulerNotificationEvent } from "../shared/scheduler.js";
import "./components/top-bar.js";
import "./components/message-list.js";
import "./components/composer.js";
import "./components/settings-modal.js";
import "./components/chat-history.js";
import type { LiltComposer } from "./components/composer.js";
import type { AgentLoopEvent, LoopState } from "../shared/agent-loop.js";
import { createInitialLoopState, reduceLoopState } from "../shared/agent-loop.js";

const SIDEBAR_WIDTH_STORAGE_KEY = "lilto-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;

type StoredSession = Partial<Session> & Pick<Session, "id" | "title">;

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
  private _unsubscribeOpenConversationListener: (() => void) | null = null;
  private _pendingAssistantMessageId: string | null = null;
  private _pendingConversationId: string | null = null;
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
    void this._loadSessions();
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
    this._unsubscribeOpenConversationListener = window.lilto.onOpenConversation((conversationId) => {
      void this._openConversation(conversationId);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopSidebarResize();
    this._unsubscribeAuthListener?.();
    this._unsubscribeLoopListener?.();
    this._unsubscribeSchedulerListener?.();
    this._unsubscribeFocusListener?.();
    this._unsubscribeOpenConversationListener?.();
    this._unsubscribeAuthListener = null;
    this._unsubscribeLoopListener = null;
    this._unsubscribeSchedulerListener = null;
    this._unsubscribeFocusListener = null;
    this._unsubscribeOpenConversationListener = null;
  }

  private _resetForegroundRequestState() {
    this._pendingAssistantMessageId = null;
    this._pendingConversationId = null;
    this._activeRequestId = null;
    this._statusLines = [];
    this._thinkingText = "";
    this._toolProgress = [];
    this._pendingLabel = "";
  }

  private async _loadSessions() {
    const result = await window.lilto.listConversations();
    if (!result.ok) {
      this.sessions = this.sessions.filter((session) => isHeartbeatAssistantSessionId(session.id));
      return;
    }

    const existingById = new Map(this.sessions.map((session) => [session.id, session]));
    const backendSessions = result.conversations.map((session) => {
      const normalized = this._normalizeSession(session);
      const existing = existingById.get(normalized.id);
      return {
        ...normalized,
        hasUnread: existing?.hasUnread ?? normalized.hasUnread,
        messages: existing?.messages ?? normalized.messages
      };
    });
    const localOnlySessions = this.sessions.filter((session) => isHeartbeatAssistantSessionId(session.id));
    this.sessions = this._sortSessions([...backendSessions, ...localOnlySessions]);
  }

  private _saveSessions() {
    this.sessions = this._sortSessions(this.sessions);
  }

  private _normalizeSession(session: StoredSession): Session {
    const createdAt = typeof session.createdAt === "number" ? session.createdAt : Date.now();
    const updatedAt = typeof session.updatedAt === "number" ? session.updatedAt : createdAt;

    return {
      id: session.id,
      title: session.title,
      createdAt,
      updatedAt,
      hasUnread: session.hasUnread === true,
      backendSessionId: typeof session.backendSessionId === "string" ? session.backendSessionId : undefined,
      messages: Array.isArray(session.messages) ? session.messages : []
    };
  }

  private _sortSessions(sessions: Session[]): Session[] {
    return [...sessions].sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return right.createdAt - left.createdAt;
    });
  }

  private _updateSession(sessionId: string, mutate: (session: Session) => Session): Session | null {
    let updatedSession: Session | null = null;
    this.sessions = this.sessions.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }
      updatedSession = mutate(session);
      return updatedSession;
    });
    if (!updatedSession) {
      return null;
    }
    this._saveSessions();
    return updatedSession;
  }

  private _shouldMarkSessionUnread(sessionId: string, role: Message["role"]): boolean {
    return sessionId !== this._currentSessionId && (role === "assistant" || role === "system" || role === "error");
  }

  private _shouldTouchSessionForMessagePatch(patch: Partial<Message>): boolean {
    return Object.prototype.hasOwnProperty.call(patch, "text") || Object.prototype.hasOwnProperty.call(patch, "role");
  }

  private _markSessionRead(sessionId: string): Session | null {
    return this._updateSession(sessionId, (session) => ({ ...session, hasUnread: false }));
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

  private _messagesEqual(left: Message[], right: Message[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private _saveCurrentSession() {
    if (!this._currentSessionId) {
      return;
    }

    const existingSession = this.sessions.find((session) => session.id === this._currentSessionId) ?? null;
    const title = existingSession?.title ?? "会話";

    this.sessions = this.sessions.map((session) =>
      session.id === this._currentSessionId
        ? {
            ...session,
            title,
            messages: [...this.messages],
            updatedAt:
              session.title === title && this._messagesEqual(session.messages, this.messages)
                ? session.updatedAt
                : Date.now(),
            hasUnread: false
          }
        : session
    );
    this._saveSessions();
  }

  private async _ensureConversation(titleHint?: string): Promise<string | null> {
    if (this._currentSessionId) {
      return this._currentSessionId;
    }

    const result = await window.lilto.createConversation(titleHint);
    if (!result.ok) {
      this._addMessage("error", `${result.error.code}: ${result.error.message}`);
      return null;
    }

    const session = this._normalizeSession(result.conversation);
    session.messages = [...this.messages];
    this.sessions = this._sortSessions([session, ...this.sessions.filter((entry) => entry.id !== session.id)]);
    this._currentSessionId = session.id;
    this.activeSessionId = session.id;
    return session.id;
  }

  private async _refreshConversation(conversationId: string) {
    const result = await window.lilto.readConversation(conversationId);
    if (!result.ok) {
      return;
    }

    const nextSession = this._normalizeSession(result.conversation);
    const existing = this.sessions.find((session) => session.id === conversationId) ?? null;
    this.sessions = this._sortSessions([
      nextSession,
      ...this.sessions.filter((session) => session.id !== conversationId)
    ].map((session) =>
      session.id === nextSession.id
        ? { ...session, hasUnread: existing?.hasUnread ?? nextSession.hasUnread }
        : session
    ));

    if (this._currentSessionId === conversationId) {
      this.messages = [...nextSession.messages];
      this.activeSessionId = conversationId;
    }
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
    void this._openConversation(e.detail.id);
  }

  private async _openConversation(conversationId: string) {
    const session = this.sessions.find((entry) =>
      entry.id === conversationId || entry.backendSessionId === conversationId
    ) ?? null;
    if (!session) {
      return;
    }
    if (session.id === this._currentSessionId) {
      return;
    }

    const targetSessionId = session.id;
    this._saveCurrentSession();
    const nextSession = this._markSessionRead(targetSessionId)
      ?? this.sessions.find((entry) => entry.id === targetSessionId)
      ?? null;
    if (!nextSession) {
      return;
    }

    const loaded = await window.lilto.readConversation(nextSession.backendSessionId ?? nextSession.id);
    const hydratedSession = loaded.ok ? this._normalizeSession(loaded.conversation) : nextSession;
    this.sessions = this._sortSessions([
      { ...hydratedSession, hasUnread: false },
      ...this.sessions.filter((entry) => entry.id !== hydratedSession.id)
    ]);

    this.messages = [...hydratedSession.messages];
    this._currentSessionId = nextSession.id;
    this.activeSessionId = nextSession.id;
    this.loopState = createInitialLoopState();
    this._resetForegroundRequestState();
  }

  private _onRenameSession(e: CustomEvent<{ sessionId: string; newTitle: string }>) {
    const { sessionId, newTitle } = e.detail;
    void window.lilto.renameConversation(sessionId, newTitle).then((result) => {
      if (!result.ok) {
        return;
      }
      this.sessions = this.sessions.map((s) =>
        s.id === sessionId ? { ...s, title: newTitle } : s
      );
      this._saveSessions();
    });
  }

  private _onDeleteSession(e: CustomEvent<{ sessionId: string }>) {
    const { sessionId } = e.detail;
    void window.lilto.archiveConversation(sessionId).then((result) => {
      if (!result.ok) {
        return;
      }
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);
      this._saveSessions();
      if (sessionId === this._currentSessionId) {
        this.messages = [];
        this.loopState = createInitialLoopState();
        this._currentSessionId = null;
        this.activeSessionId = null;
      }
    });
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
    this._resetForegroundRequestState();
    this._currentSessionId = null;
    this.activeSessionId = null;
  }

  private _onAbortRequest() {
    void window.lilto.abortPrompt();
  }

  private async _doSend(text: string) {
    const conversationId = this._currentSessionId;
    if (!conversationId) {
      this._addMessage("error", "UNEXPECTED: 会話セッションを開始できませんでした");
      return;
    }

    const pendingMessageId = this._appendMessageToSession(conversationId, {
      id: this._nextMessageId(),
      role: "assistant",
      text: "実行開始を待っています...",
      pending: true
    });
    this._pendingAssistantMessageId = pendingMessageId;
    this._pendingConversationId = conversationId;
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
      const activeSession = this.sessions.find((session) => session.id === conversationId) ?? null;
      const result = await window.lilto.submitPrompt(
        text,
        conversationId,
        activeSession?.backendSessionId ?? null
      );
      if (result.ok) {
        this._updateSessionMessage(conversationId, pendingMessageId, {
          text: result.response.text,
          pending: false,
          progress: this._buildProgress()
        });
        await this._refreshConversation(conversationId);
        await this.updateComplete;
        if (this._currentSessionId === conversationId) {
          this._composer?.focusInput();
        }
        return;
      }
      const error = result.error ?? { code: "UNKNOWN", message: "不明なエラー" };
      if (error.code === "ABORTED") {
        this._updateSessionMessage(conversationId, pendingMessageId, {
          text: "",
          pending: false,
          progress: this._buildProgress()
        });
      } else {
        this._removeSessionMessage(conversationId, pendingMessageId);
        this._appendMessageToSession(conversationId, {
          id: this._nextMessageId(),
          role: "error",
          text: `${error.code}: ${error.message}`
        });
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
    } catch (err) {
      this._removeSessionMessage(conversationId, pendingMessageId);
      this._appendMessageToSession(conversationId, {
        id: this._nextMessageId(),
        role: "error",
        text: `UNEXPECTED: ${String(err)}`
      });
    } finally {
      this.isSending = false;
      this._resetForegroundRequestState();
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
    const title = text.slice(0, 40) + (text.length > 40 ? "…" : "");
    const conversationId = await this._ensureConversation(title);
    if (!conversationId) {
      return;
    }
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
    if (event.type === "session_bound" && event.conversationId) {
      this._bindBackendSession(event.conversationId, event.agentSessionId);
    }

    if (!this._shouldTrackForegroundLoopEvent(event)) {
      return;
    }

    this.loopState = reduceLoopState(this.loopState, event);
    this._appendProgressLineFromLoopEvent(event);
  }

  private _shouldTrackForegroundLoopEvent(event: AgentLoopEvent): boolean {
    if (this._activeRequestId) {
      return event.requestId === this._activeRequestId;
    }

    if (!this._pendingConversationId) {
      return false;
    }

    return event.type === "run_start" && event.conversationId === this._pendingConversationId;
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

    if (shouldRunConditionalSchedulerFollowUp(event)) {
      void this._runConditionalSchedulerFollowUp(targetSession.id, event);
      return;
    }

    const notificationText = event.followUpInstruction
      ? `${event.message}\n続きの処理: ${event.followUpInstruction}`
      : event.message;
    this._appendMessageToSession(targetSession.id, {
      id: this._nextMessageId(),
      role: "assistant",
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
          session?.backendSessionId ?? null,
          { freshContext: true }
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

  private async _runConditionalSchedulerFollowUp(conversationId: string, event: SchedulerNotificationEvent) {
    const session = this.sessions.find((entry) => entry.id === conversationId) ?? null;

    try {
      const result = await window.lilto.submitPrompt(
        buildConditionalSchedulerFollowUpPrompt(event),
        conversationId,
        session?.backendSessionId ?? null,
          { silent: true, freshContext: true }
      );
      if (result.ok) {
        const decision = parseSchedulerNotificationDecision(result.response.text);
        if (!decision) {
          await this._notifySchedulerDecision(conversationId, {
            shouldNotify: true,
            userMessage: result.response.text.trim() || event.message
          });
          return;
        }
        await this._notifySchedulerDecision(conversationId, decision);
        return;
      }

      const error = result.error ?? { code: "UNKNOWN", message: "不明なエラー" };
      await this._notifySchedulerDecision(conversationId, {
        shouldNotify: true,
        role: "error",
        userMessage: `${error.code}: ${error.message}`
      });
    } catch (error) {
      await this._notifySchedulerDecision(conversationId, {
        shouldNotify: true,
        role: "error",
        userMessage: `UNEXPECTED: ${String(error)}`
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

  private async _notifySchedulerDecision(
    conversationId: string,
    decision: { shouldNotify: boolean; userMessage: string; role?: "assistant" | "error" }
  ) {
    if (!decision.shouldNotify) {
      return;
    }

    const userMessage = decision.userMessage.trim();
    if (!userMessage) {
      return;
    }

    this._appendMessageToSession(conversationId, {
      id: this._nextMessageId(),
      role: decision.role ?? "assistant",
      text: userMessage
    });
    await window.lilto.showSchedulerNotification(userMessage, conversationId);
  }

  private _appendProgressLineFromLoopEvent(event: AgentLoopEvent) {
    if (!this._pendingAssistantMessageId || !this._pendingConversationId) return;

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

    this._updateSessionMessage(this._pendingConversationId, this._pendingAssistantMessageId, {
      text: "実行中...",
      pending: true,
      progress: this._buildProgress()
    });
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

  private _addMessage(role: Message["role"], text: string, progress?: AssistantProgress): string {
    const msg: Message = {
      id: this._nextMessageId(),
      requestId: this._activeRequestId ?? undefined,
      role,
      text,
      progress
    };
    this.messages = [...this.messages, msg];
    return msg.id;
  }

  private _addPendingMessage(role: Message["role"], text: string, progress?: AssistantProgress): string {
    const msg: Message = {
      id: this._nextMessageId(),
      requestId: this._activeRequestId ?? undefined,
      role,
      text,
      pending: true,
      progress
    };
    this.messages = [...this.messages, msg];
    return msg.id;
  }

  private _attachRequestIdToPendingMessage(requestId: string) {
    if (!this._pendingAssistantMessageId || !this._pendingConversationId) return;
    this._updateSessionMessage(this._pendingConversationId, this._pendingAssistantMessageId, { requestId });
  }

  private _nextMessageId(): string {
    this._messageSeq += 1;
    return `msg-${this._messageSeq}`;
  }

  private _resolvePendingMessage(messageId: string, text: string, progress?: AssistantProgress) {
    this.messages = this.messages.map((m) =>
      m.id === messageId ? { ...m, text, pending: false, progress } : m
    );
  }

  private _updatePendingMessage(messageId: string, text: string, progress?: AssistantProgress) {
    this.messages = this.messages.map((m) =>
      m.id === messageId ? { ...m, text, pending: true, progress } : m
    );
  }

  private _removePendingMessage(messageId: string) {
    this.messages = this.messages.filter((message) => message.id !== messageId);
  }

  private _appendMessageToSession(sessionId: string, message: Message): string {
    const shouldMarkUnread = this._shouldMarkSessionUnread(sessionId, message.role);
    this._updateSession(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
      hasUnread: shouldMarkUnread ? true : session.hasUnread
    }));

    if (this._currentSessionId === sessionId) {
      this.messages = [...this.messages, message];
    }

    return message.id;
  }

  private _updateSessionMessage(sessionId: string, messageId: string, patch: Partial<Message>) {
    this._updateSession(sessionId, (session) => {
      let nextRole: Message["role"] | null = null;
      const messages = session.messages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }
        const nextMessage = { ...message, ...patch };
        nextRole = nextMessage.role;
        return nextMessage;
      });

      const shouldTouch = this._shouldTouchSessionForMessagePatch(patch);
      const shouldMarkUnread = nextRole ? this._shouldMarkSessionUnread(sessionId, nextRole) && shouldTouch : false;

      return {
        ...session,
        messages,
        updatedAt: shouldTouch ? Date.now() : session.updatedAt,
        hasUnread: shouldMarkUnread ? true : session.hasUnread
      };
    });

    if (this._currentSessionId === sessionId) {
      this.messages = this.messages.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message
      );
    }
  }

  private _removeSessionMessage(sessionId: string, messageId: string) {
    this._updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.filter((message) => message.id !== messageId),
      updatedAt: Date.now()
    }));

    if (this._currentSessionId === sessionId) {
      this._removePendingMessage(messageId);
    }
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
      updatedAt: Date.now(),
      hasUnread: false,
      messages: []
    };
    this.sessions = [session, ...this.sessions];
    this._saveSessions();
    return session.id;
  }
}
