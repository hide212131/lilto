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
      width: 240px;
      min-width: 240px;
      height: 100%;
      background: var(--surface, #ffffff);
      border-right: 1px solid var(--line, #dddddf);
      overflow: hidden;
    }
    .header {
      padding: 12px 16px;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted, #6b7280);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--line, #dddddf);
      flex-shrink: 0;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .list::-webkit-scrollbar {
      width: 4px;
    }
    .list::-webkit-scrollbar-track {
      background: transparent;
    }
    .list::-webkit-scrollbar-thumb {
      background: var(--line, #dddddf);
      border-radius: 2px;
    }
    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--muted, #6b7280);
      font-size: 13px;
      line-height: 1.5;
    }
    .session-item {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 2px;
      padding: 10px 8px 10px 16px;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: background 0.1s;
    }
    .session-item:hover {
      background: var(--bg, #f3f3f4);
    }
    .session-item.active {
      background: #eff6ff;
      border-left-color: #3b82f6;
    }
    .session-item.editing {
      cursor: default;
    }
    .session-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .session-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text, #1f2328);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-date {
      font-size: 11px;
      color: var(--muted, #6b7280);
    }
    .session-title-input {
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      color: var(--text, #1f2328);
      border: 1px solid #3b82f6;
      border-radius: 4px;
      padding: 1px 5px;
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
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      color: var(--muted, #6b7280);
      opacity: 0;
      transition: opacity 0.1s, background 0.1s;
      padding: 0;
      font-size: 16px;
      line-height: 1;
    }
    .session-item:hover .menu-btn,
    .menu-btn.open {
      opacity: 1;
    }
    .menu-btn:hover {
      background: var(--line, #dddddf);
      color: var(--text, #1f2328);
    }
    .dropdown {
      position: absolute;
      right: 8px;
      top: calc(100% - 4px);
      z-index: 100;
      background: #ffffff;
      border: 1px solid var(--line, #dddddf);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      min-width: 140px;
      overflow: hidden;
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 14px;
      font-size: 13px;
      color: var(--text, #1f2328);
      cursor: pointer;
      transition: background 0.1s;
    }
    .dropdown-item:hover {
      background: var(--bg, #f3f3f4);
    }
    .dropdown-item.danger {
      color: #dc2626;
    }
    .dropdown-item.danger:hover {
      background: #fef2f2;
    }
  `;

  render() {
    return html`
      <div class="header">会話履歴</div>
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
            : html`<div class="session-title">${session.title}</div>`
          }
          <div class="session-date">${dateLabel}</div>
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
                ✏️ 名称変更
              </div>
              <div class="dropdown-item danger" @click=${(e: Event) => this._onDelete(e, session)}>
                🗑️ 削除
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
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    }
    if (diffDays === 1) return "昨日";
    if (diffDays < 7) return `${diffDays}日前`;
    return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  }

  private _selectSession(session: Session) {
    this.dispatchEvent(new CustomEvent("select-session", {
      detail: session,
      bubbles: true,
      composed: true
    }));
  }
}
