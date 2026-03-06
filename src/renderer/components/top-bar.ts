import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("lilt-top-bar")
export class LiltTopBar extends LitElement {
  @property() statusText = "待機中";
  @property({ type: Boolean }) newSessionDisabled = false;
  @property({ type: Boolean }) sidebarOpen = false;

  static styles = css`
    :host {
      display: block;
    }
    .topbar {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      border-bottom: 1px solid var(--line, #dddddf);
      background: var(--surface, #ffffff);
    }
    .topbar-left,
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .topbar-title {
      font-size: 24px;
      font-weight: 700;
    }
    .icon-btn {
      border: 0;
      background: transparent;
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
    .icon-btn.active {
      background: #e0e7ff;
      color: #4f46e5;
    }
    .status {
      font-size: 14px;
      color: var(--muted, #6b7280);
    }
    @media (max-width: 720px) {
      .topbar-title {
        font-size: 20px;
      }
    }
  `;

  render() {
    return html`
      <div class="topbar">
        <div class="topbar-left">
          <button
            class="icon-btn ${this.sidebarOpen ? "active" : ""}"
            @click=${this._toggleSidebar}
            type="button"
            title="会話履歴"
          >☰</button>
          <button
            class="icon-btn"
            @click=${this._startNewSession}
            ?disabled=${this.newSessionDisabled}
            type="button"
            title="New"
          >
            ＋
          </button>
          <div class="topbar-title">Lilt-o</div>
        </div>
        <div class="topbar-right">
          <div class="status">${this.statusText}</div>
          <button class="icon-btn" @click=${this._openSettings} type="button" title="Settings">⚙</button>
        </div>
      </div>
    `;
  }

  private _toggleSidebar() {
    this.dispatchEvent(new CustomEvent("toggle-sidebar", { bubbles: true, composed: true }));
  }

  private _openSettings() {
    this.dispatchEvent(new CustomEvent("open-settings", { bubbles: true, composed: true }));
  }

  private _startNewSession() {
    if (this.newSessionDisabled) return;
    this.dispatchEvent(new CustomEvent("new-session", { bubbles: true, composed: true }));
  }
}
