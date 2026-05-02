import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Session } from "../types.js";

@customElement("lilt-chat-history")
export class LiltChatHistory extends LitElement {
  @property({ type: Array }) sessions: Session[] = [];
  @property() activeSessionId: string | null = null;
  @state() private _menuOpenId: string | null = null;
  @state() private _editingId: string | null = null;
  @state() private _editingTitle = "";

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
    .session-item {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
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
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      color: var(--muted, #6b7280);
      opacity: 0;
      transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
      padding: 0;
      font-size: 16px;
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
    return html`
      <div class="list">
        ${this.sessions.length === 0
          ? html`<div class="empty">まだ会話がありません</div>`
          : this.sessions.map((s) => this._renderItem(s))
        }
      </div>
    `;
  }

  private _renderItem(session: Session) {
    const isActive = session.id === this.activeSessionId;
    const isEditing = this._editingId === session.id;
    const date = new Date(session.createdAt);
    const dateLabel = this._formatDate(date);
    const menuOpen = this._menuOpenId === session.id;
    return html`
      <div
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
