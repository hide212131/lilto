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
      width: 32px;
      height: 32px;
      border-radius: 8px;
      padding: 0;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
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
          <button class="icon-btn" @click=${this._openSettings} type="button" title="Settings">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
            </svg>
          </button>
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
