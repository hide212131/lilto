import { LitElement, html, css, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Session } from "../types.js";
import { extractActivityPreview, type ActivityPreview } from "../sidebar-activity.js";
import type { SchedulerScheduleSummary } from "../../shared/scheduler.js";

@customElement("lilt-chat-history")
export class LiltChatHistory extends LitElement {
  @property({ type: Array }) sessions: Session[] = [];
  @property({ attribute: false }) runningSessionIds: string[] = [];
  @property({ type: Array }) schedules: SchedulerScheduleSummary[] = [];
  @property() activeSessionId: string | null = null;
  @property({ type: Boolean }) activityMode = false;
  @property({ attribute: false }) activityPreviews: Record<string, ActivityPreview> = {};
  @state() private _menuOpenId: string | null = null;
  @state() private _editingId: string | null = null;
  @state() private _editingTitle = "";
  @state() private _keyword = "";
  @state() private _searching = false;
  @state() private _searchFailed = false;
  private _searchGeneration = 0;
  private _searchTimer?: ReturnType<typeof setTimeout>;
  private _searchContent = new Map<string, { updatedAt: number; text: string }>();

  private async _loadSearchContent() {
    const generation = this._searchGeneration;
    const pending = this.sessions.filter((session) =>
      session.backendSessionId && this._searchContent.get(session.id)?.updatedAt !== session.updatedAt);
    const worker = async () => {
      while (pending.length && generation === this._searchGeneration) {
        const session = pending.shift()!;
        try {
          const result = await window.lilto.readConversation(session.id);
          if (generation !== this._searchGeneration) return;
          if (!result.ok) throw new Error("History unavailable");
          this._searchContent.set(session.id, {
            updatedAt: session.updatedAt,
            text: result.conversation.messages.map((message) => message.text).join("\n").toLocaleLowerCase()
          });
          this.requestUpdate();
        } catch {
          if (generation === this._searchGeneration) this._searchFailed = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
    if (generation === this._searchGeneration) this._searching = false;
  }

  private _onSearchInput(event: Event) {
    this._keyword = (event.target as HTMLInputElement).value;
    this._menuOpenId = null;
  }

  private _activityObserver: IntersectionObserver | null = null;

  private _onDocClick = () => {
    if (this._menuOpenId !== null) {
      this._menuOpenId = null;
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocClick);
    clearTimeout(this._searchTimer);
    this._searchGeneration += 1;
    this._activityObserver?.disconnect();
    this._activityObserver = null;
  }

  updated(changed: PropertyValues) {
    if (changed.has("sessions") || changed.has("_keyword")) {
      clearTimeout(this._searchTimer);
      this._searchGeneration += 1;
      this._searching = Boolean(this._keyword.trim());
      this._searchFailed = false;
      if (this._searching) {
        this._searchTimer = setTimeout(() => void this._loadSearchContent(), 200);
      }
      const ids = new Set(this.sessions.map((session) => session.id));
      for (const id of this._searchContent.keys()) {
        if (!ids.has(id)) this._searchContent.delete(id);
      }
    }

    this._activityObserver?.disconnect();
    this._activityObserver = null;
    if (!this.activityMode || !("IntersectionObserver" in window)) return;
    this._activityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.sessionId;
        const session = this.sessions.find((item) => item.id === id);
        if (session) this._requestPreview(session);
      }
    }, { root: this.renderRoot.querySelector(".list"), rootMargin: "80px" });
    this.renderRoot.querySelectorAll<HTMLElement>(".activity-item[data-session-id]").forEach((item) => {
      this._activityObserver?.observe(item);
    });
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 272px;
      min-width: 272px;
      height: 100%;
      background: var(--surface, #ffffff);
      border-right: 1px solid var(--line, #dddddf);
      overflow: hidden;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 8px 10px;
    }
    .search {
      display: flex;
      gap: 4px;
      padding: 10px 8px 4px;
      align-items: center;
    }
    .search input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid var(--line, #dddddf);
      border-radius: 8px;
      padding: 8px 10px;
      font: inherit;
      font-size: 13px;
      color: var(--text, #1f2328);
      background: var(--surface, #ffffff);
    }
    .search input:focus-visible {
      outline: 2px solid #2f6df6;
      outline-offset: 1px;
    }
    .search input::-webkit-search-cancel-button {
      display: none;
    }
    .search button, .search-status button {
      border: none;
      border-radius: 6px;
      padding: 6px;
      background: transparent;
      color: var(--muted, #6b7280);
      cursor: pointer;
      font: inherit;
    }
    .search-status {
      padding: 4px 12px;
      font-size: 12px;
      color: var(--muted, #6b7280);
    }
    .sidebar-header { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--line, #dddddf); }
    .sidebar-heading { margin: 0; font-size: 14px; font-weight: 600; color: var(--text, #1f2328); }
    .activity-toggle { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--muted, #6b7280); cursor: pointer; }
    .activity-toggle:hover, .activity-toggle[aria-pressed="true"] { background: #f1f3f5; color: var(--text, #1f2328); }
    .activity-toggle:focus-visible, .activity-item:focus-visible, .retry-preview:focus-visible { outline: 2px solid #2f6df6; outline-offset: 2px; }
    .activity-item { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; margin: 2px 4px; border-radius: 8px; cursor: pointer; }
    .activity-item:hover { background: #f5f5f5; }
    .activity-topline { display: flex; align-items: center; gap: 8px; }
    .activity-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 550; color: var(--text, #1f2328); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .activity-date { flex-shrink: 0; font-size: 11px; color: var(--muted, #6b7280); }
    .activity-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--muted, #6b7280); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    .retry-preview { align-self: flex-start; padding: 2px 0; border: 0; background: transparent; color: #2f6df6; font: inherit; font-size: 12px; cursor: pointer; }
    .list::-webkit-scrollbar {
      width: 6px;
    }
    .list::-webkit-scrollbar-track {
      background: transparent;
    }
    .list::-webkit-scrollbar-thumb {
      background: rgba(31, 35, 40, 0.16);
      border-radius: 999px;
    }
    .empty {
      padding: 14px 12px;
      color: var(--muted, #6b7280);
      font-size: 12px;
      line-height: 1.5;
    }
    .run-status { font-size: 10px; color: #765600; white-space: nowrap; }
    .category + .category {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid var(--line, #dddddf);
    }
    .category-title {
      margin: 0;
      padding: 10px 12px 6px;
      color: var(--muted, #6b7280);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.5;
    }
    .session-item {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      padding: 7px 8px 7px 12px;
      margin-bottom: 0;
      cursor: pointer;
      border-radius: 8px;
      border-left: none;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .session-item:hover {
      background: #f5f5f5;
    }
    .session-item.active {
      background: #f1f3f5;
    }
    .session-item.editing {
      cursor: default;
    }
    .session-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .session-title {
      flex: 1;
      min-width: 0;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.2;
      color: var(--text, #1f2328);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-date {
      flex-shrink: 0;
      font-size: 11px;
      color: var(--muted, #6b7280);
    }
    .unread-dot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #2f6df6;
      box-shadow: 0 0 0 2px #ffffff;
    }
    .session-title-input {
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      color: var(--text, #1f2328);
      border: 1px solid rgba(244, 163, 0, 0.9);
      border-radius: 8px;
      padding: 3px 8px;
      width: 100%;
      box-sizing: border-box;
      outline: none;
      background: #ffffff;
    }
    .menu-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      color: var(--muted, #6b7280);
      opacity: 0;
      transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
      padding: 0;
      font-size: 11px;
      line-height: 1;
    }
    .session-item:hover .menu-btn,
    .session-item.active .menu-btn,
    .menu-btn.open {
      opacity: 1;
    }
    .menu-btn:hover {
      background: #e6e7eb;
      color: var(--text, #1f2328);
    }
    .dropdown {
      position: absolute;
      right: 10px;
      top: calc(100% - 2px);
      z-index: 100;
      background: #ffffff;
      border: 1px solid var(--line, #dddddf);
      border-radius: 10px;
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.34);
      min-width: 140px;
      overflow: hidden;
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      font-size: 13px;
      color: var(--text, #1f2328);
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .dropdown-item:hover {
      background: #f5f5f5;
    }
    .dropdown-item.danger {
      color: #f87171;
    }
    .dropdown-item.danger:hover {
      background: rgba(248, 113, 113, 0.12);
    }
  `;

  render() {
    const keyword = this._keyword.trim().toLocaleLowerCase();
    const sessions = keyword ? this.sessions.filter((session) =>
      session.title.toLocaleLowerCase().includes(keyword)
      || session.messages.some((message) => message.text.toLocaleLowerCase().includes(keyword))
      || (this._searchContent.get(session.id)?.updatedAt === session.updatedAt
        && this._searchContent.get(session.id)!.text.includes(keyword))) : this.sessions;

    const cronSessionIds = new Set(
      this.schedules.filter((schedule) => schedule.kind === "cron").map((schedule) => schedule.sessionId)
    );
    const isScheduled = (session: Session) => cronSessionIds.has(session.id)
      || (!!session.backendSessionId && cronSessionIds.has(session.backendSessionId));
    const scheduledSessions = sessions.filter(isScheduled);
    const regularSessions = sessions.filter((session) => !isScheduled(session));
    return html`
      <div class="sidebar-header">
        <h2 class="sidebar-heading">${this.activityMode ? "アクティビティ" : "チャット"}</h2>
        <button class="activity-toggle" type="button" aria-label="${this.activityMode ? "チャット一覧を表示" : "アクティビティを表示"}"
          aria-pressed=${String(this.activityMode)} title="${this.activityMode ? "チャット一覧" : "アクティビティ"}"
          @click=${() => this.dispatchEvent(new CustomEvent("toggle-activity", { bubbles: true, composed: true }))}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
        </button>
      </div>
      <div class="search" role="search">
        <input type="search" placeholder="タイトル・本文で絞り込み" aria-label="会話をキーワードで絞り込み"
          .value=${this._keyword} @input=${this._onSearchInput}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") this._keyword = ""; }} />
        ${this._keyword ? html`<button aria-label="絞り込みを解除" @click=${() => { this._keyword = ""; }}>×</button>` : ""}
      </div>
      <div class="search-status" role="status" ?hidden=${!keyword}>
        ${this._searching ? "会話を検索中…" : `${sessions.length}件`}
        ${this._searchFailed ? html`<span>一部の会話を検索できませんでした</span>
          <button @click=${() => { this._searchFailed = false; this._searching = true; void this._loadSearchContent(); }}>再試行</button>` : ""}
      </div>
      <div class="list">
        ${keyword && sessions.length === 0
          ? this._searching ? "" : html`<div class="empty">${this._searchFailed ? "検索できた会話に一致するものはありません" : "一致する会話はありません"}</div>`
          : this.activityMode
          ? this.sessions.length === 0
            ? html`<div class="empty">まだアクティビティがありません</div>`
            : sessions.map((session) => this._renderActivityItem(session))
          : html`
              ${this._renderCategory("scheduled", "定期タスク", scheduledSessions, keyword ? "一致する定期タスクはありません" : "定期タスクはありません")}
              ${this._renderCategory("sessions", "セッション", regularSessions, keyword ? "一致するセッションはありません" : "まだ会話がありません")}
            `}
      </div>
    `;
  }

  private _renderActivityItem(session: Session) {
    const preview = this.activityPreviews[session.id];
    const localText = extractActivityPreview(session.messages);
    const matchingPreview = preview?.updatedAt === session.updatedAt ? preview : undefined;
    const text = localText || matchingPreview?.text;
    const date = new Date(session.updatedAt);
    return html`
      <div class="activity-item" data-session-id=${session.id}>
        <div class="activity-main" role="button" tabindex="0" aria-label=${`${session.title}: ${text ?? ""}`}
          @click=${() => this._selectSession(session)}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this._selectSession(session); } }}>
        <div class="activity-topline"><span class="activity-title">${session.title}</span><time class="activity-date" title=${date.toLocaleString()}>${this._formatDate(date)}</time>
          ${this._renderRunStatus(session.id)}
          ${session.hasUnread && session.id !== this.activeSessionId ? html`<span class="unread-dot" aria-label="未読"></span>` : ""}</div>
        <div class="activity-preview">${text || (matchingPreview?.status === "error" ? "内容を取得できませんでした" : matchingPreview?.status === "empty" ? "まだメッセージがありません" : "読み込み中…")}</div>
        </div>
        ${matchingPreview?.status === "error" ? html`<button class="retry-preview" @click=${(event: Event) => { event.stopPropagation(); this.dispatchEvent(new CustomEvent("activity-preview-retry", { detail: { session }, bubbles: true, composed: true })); }}>再試行</button>` : ""}
      </div>
    `;
  }

  private _requestPreview(session: Session) {
    const localText = extractActivityPreview(session.messages);
    if (localText || this.activityPreviews[session.id]?.updatedAt === session.updatedAt) return;
    this.dispatchEvent(new CustomEvent("activity-preview-needed", { detail: { session }, bubbles: true, composed: true }));
  }

  private _renderRunStatus(sessionId: string) {
    return this.runningSessionIds.includes(sessionId)
      ? html`<span class="run-status" aria-label="実行中">実行中</span>`
      : "";
  }

  private _renderCategory(id: string, title: string, sessions: Session[], emptyText: string) {
    return html`
      <section class="category" aria-labelledby=${id}>
        <h2 class="category-title" id=${id}>${title}</h2>
        ${sessions.length === 0
          ? html`<div class="empty">${emptyText}</div>`
          : sessions.map((session) => this._renderItem(session))}
      </section>
    `;
  }

  private _renderItem(session: Session) {
    const isActive = session.id === this.activeSessionId;
    const isEditing = this._editingId === session.id;
    const date = new Date(session.updatedAt);
    const dateLabel = this._formatDate(date);
    const menuOpen = this._menuOpenId === session.id;
    return html`
      <div
        data-session-id=${session.id}
        class="session-item ${isActive ? "active" : ""} ${isEditing ? "editing" : ""}"
        @click=${() => !isEditing && this._selectSession(session)}
      >
        <div class="session-info">
          ${isEditing
            ? html`<input
                class="session-title-input"
                .value=${this._editingTitle}
                @input=${(e: Event) => { this._editingTitle = (e.target as HTMLInputElement).value; }}
                @keydown=${(e: KeyboardEvent) => this._onEditKeydown(e, session)}
                @blur=${() => this._commitRename(session)}
                @click=${(e: Event) => e.stopPropagation()}
              />`
            : html`
              <div class="session-title">${session.title}</div>
              <div class="session-date">${dateLabel}</div>
            `
          }
        </div>
        ${this._renderRunStatus(session.id)}
        ${session.hasUnread && !isActive && !isEditing
          ? html`<span class="unread-dot" aria-label="未読"></span>`
          : ""}
        ${!isEditing ? html`
          <button
            class="menu-btn ${menuOpen ? "open" : ""}"
            title="オプション"
            @click=${(e: Event) => this._toggleMenu(e, session.id)}
          >⋮</button>
          ${menuOpen ? html`
            <div class="dropdown" @click=${(e: Event) => e.stopPropagation()}>
              <div class="dropdown-item" @click=${(e: Event) => this._onRename(e, session)}>
                名称変更
              </div>
              <div class="dropdown-item danger" @click=${(e: Event) => this._onDelete(e, session)}>
                削除
              </div>
            </div>
          ` : ""}
        ` : ""}
      </div>
    `;
  }

  private _toggleMenu(e: Event, sessionId: string) {
    e.stopPropagation();
    this._menuOpenId = this._menuOpenId === sessionId ? null : sessionId;
  }

  private _onRename(e: Event, session: Session) {
    e.stopPropagation();
    this._menuOpenId = null;
    this._editingId = session.id;
    this._editingTitle = session.title;
    // Focus the input after render
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>(".session-title-input");
      input?.focus();
      input?.select();
    });
  }

  private _onEditKeydown(e: KeyboardEvent, session: Session) {
    if (e.key === "Enter") {
      this._commitRename(session);
    } else if (e.key === "Escape") {
      this._cancelRename();
    }
  }

  private _commitRename(session: Session) {
    if (this._editingId !== session.id) return;
    const newTitle = this._editingTitle.trim();
    this._editingId = null;
    if (newTitle && newTitle !== session.title) {
      this.dispatchEvent(new CustomEvent("rename-session", {
        detail: { sessionId: session.id, newTitle },
        bubbles: true,
        composed: true
      }));
    }
  }

  private _cancelRename() {
    this._editingId = null;
  }

  private _onDelete(e: Event, session: Session) {
    e.stopPropagation();
    this._menuOpenId = null;
    this.dispatchEvent(new CustomEvent("delete-session", {
      detail: { sessionId: session.id },
      bubbles: true,
      composed: true
    }));
  }

  private _formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMinutes < 60) {
      return `${Math.max(1, diffMinutes)}分`;
    }
    if (diffHours < 24) {
      return `${diffHours}時間`;
    }
    if (diffDays < 7) {
      return `${diffDays}日`;
    }
    if (diffWeeks < 5) {
      return `${diffWeeks}週間`;
    }
    return `${Math.max(1, diffMonths)}か月`;
  }

  private _selectSession(session: Session) {
    this.dispatchEvent(new CustomEvent("select-session", {
      detail: session,
      bubbles: true,
      composed: true
    }));
  }
}
