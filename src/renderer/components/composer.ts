import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";

@customElement("lilt-composer")
export class LiltComposer extends LitElement {
  @property({ type: Boolean }) disabled = false;

  @query("textarea") private _textarea!: HTMLTextAreaElement;

  private _isComposing = false;
  private _compositionEndAt = 0;

  static styles = css`
    :host {
      display: block;
    }
    .composer-wrap {
      margin: 6px 0 12px;
      padding: 0 0 10px;
      display: flex;
      justify-content: center;
    }
    .composer {
      background: var(--surface, #ffffff);
      border: 1px solid var(--line, #dddddf);
      border-radius: 14px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(700px, calc(100% - 8px));
      box-shadow: 0 1px 0 rgba(17, 24, 39, 0.03);
    }
    textarea {
      width: 100%;
      min-height: 56px;
      max-height: 160px;
      border: 0;
      outline: none;
      font-size: 16px;
      line-height: 1.4;
      resize: vertical;
      background: transparent;
      color: var(--text, #1f2328);
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      box-sizing: border-box;
    }
    textarea::placeholder {
      color: #9ca3af;
    }
    textarea:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .hint {
      font-size: 14px;
      color: var(--muted, #6b7280);
    }
    button {
      background: var(--accent, #111827);
      color: #fff;
      border: 1px solid var(--accent, #111827);
      border-radius: 999px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  render() {
    return html`
      <div class="composer-wrap">
        <div class="composer">
          <textarea
            placeholder="Type a message..."
            .disabled=${this.disabled}
            @compositionstart=${this._onCompositionStart}
            @compositionend=${this._onCompositionEnd}
            @keydown=${this._onKeyDown}
          ></textarea>
          <div class="actions">
            <span class="hint">Cmd/Ctrl + Enter で送信</span>
            <button .disabled=${this.disabled} @click=${this._onSend}>送信</button>
          </div>
        </div>
      </div>
    `;
  }

  focusInput() {
    this._textarea?.focus();
  }

  private _onCompositionStart() {
    this._isComposing = true;
  }

  private _onCompositionEnd() {
    this._isComposing = false;
    this._compositionEndAt = Date.now();
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (this._isComposing || Date.now() - this._compositionEndAt < 20) return;
      this._onSend();
    }
  }

  private _onSend() {
    if (this.disabled) return;
    const text = this._textarea.value.trim();
    if (!text) return;
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { text },
        bubbles: true,
        composed: true
      })
    );
    this._textarea.value = "";
  }
}
