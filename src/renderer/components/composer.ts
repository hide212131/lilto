import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";

@customElement("lilt-composer")
export class LiltComposer extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) isSending = false;
  @property({ type: Boolean }) enterToSend = false;

  @query("textarea") private _textarea!: HTMLTextAreaElement;

  private _isComposing = false;
  private _compositionEndAt = 0;
  private _lastSentText = "";

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
    .btn-group {
      display: flex;
      gap: 8px;
      align-items: center;
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
    .btn-abort {
      background: #dc2626;
      border-color: #dc2626;
    }
    .btn-abort:hover {
      background: #b91c1c;
      border-color: #b91c1c;
    }
  `;

  render() {
    const hint = this.enterToSend ? "Enter で送信 / Shift+Enter で改行" : "Cmd/Ctrl + Enter で送信";
    return html`
      <div class="composer-wrap">
        <div class="composer">
          <textarea
            placeholder="Type a message..."
            .disabled=${this.disabled && !this.isSending}
            @compositionstart=${this._onCompositionStart}
            @compositionend=${this._onCompositionEnd}
            @keydown=${this._onKeyDown}
          ></textarea>
          <div class="actions">
            <span class="hint">${hint}</span>
            <div class="btn-group">
              ${this.isSending
                ? html`<button class="btn-abort" @click=${this._onAbort}>中断</button>`
                : html`<button .disabled=${this.disabled} @click=${this._onSend}>送信</button>`}
            </div>
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
    if (e.key === "ArrowUp") {
      const textarea = this._textarea;
      if (textarea && textarea.value === "" && this._lastSentText) {
        e.preventDefault();
        textarea.value = this._lastSentText;
        // Move cursor to end
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        return;
      }
    }

    if (e.key === "Enter") {
      const isComposing = this._isComposing || Date.now() - this._compositionEndAt < 20;
      if (isComposing) return;

      if (this.enterToSend) {
        // Enter sends; Shift+Enter inserts newline
        if (!e.shiftKey) {
          e.preventDefault();
          this._onSend();
        }
      } else {
        // Legacy: Cmd/Ctrl+Enter sends
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          this._onSend();
        }
      }
    }
  }

  private _onAbort() {
    this.dispatchEvent(
      new CustomEvent("abort-request", {
        bubbles: true,
        composed: true
      })
    );
  }

  private _onSend() {
    if (this.disabled || this.isSending) return;
    const text = this._textarea.value.trim();
    if (!text) return;
    this._lastSentText = text;
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
