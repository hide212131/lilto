import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Session } from "../types.js";

@customElement("lilt-chat-history")
export class LiltChatHistory extends LitElement {
  @property({ type: Array }) sessions: Session[] = [];
  @property() activeSessionId: string | null = null;

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
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 16px;
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
    const date = new Date(session.createdAt);
    const dateLabel = this._formatDate(date);
    return html`
      <div
        class="session-item ${isActive ? "active" : ""}"
        @click=${() => this._selectSession(session)}
      >
        <div class="session-title">${session.title}</div>
        <div class="session-date">${dateLabel}</div>
      </div>
    `;
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
