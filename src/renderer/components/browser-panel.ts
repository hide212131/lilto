import { LitElement, html, css, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";

import type { BrowserPanelState } from "../../shared/browser.js";

/** Toolbar + status + the (empty) viewport the native page view is laid over. */
@customElement("lilt-browser-panel")
export class LiltBrowserPanel extends LitElement {
  @property({ attribute: false }) state: BrowserPanelState | null = null;
  @property() ownerLabel = "";
  @property({ type: Boolean }) tooNarrow = false;
  @property({ type: String }) addressDraft = "";
  @query(".viewport") private _viewport!: HTMLDivElement;
  private _editing = false;

  get viewportElement(): HTMLElement | null {
    return this._viewport ?? null;
  }

  static styles = css`
    :host { display: flex; flex-direction: column; min-width: 0; height: 100%; background: var(--surface, #fff); border-left: 1px solid var(--line, #dddddf); }
    .toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line, #dddddf); }
    .toolbar button { min-width: 30px; height: 30px; border: 1px solid transparent; border-radius: 6px; background: transparent; cursor: pointer; font: inherit; color: inherit; }
    .toolbar button:hover:not(:disabled) { background: #f3f4f6; }
    .toolbar button:disabled { opacity: 0.4; cursor: default; }
    .toolbar button:focus-visible, input:focus-visible { outline: 2px solid #4169e1; outline-offset: 1px; }
    input { flex: 1; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--line, #dddddf); border-radius: 6px; font: inherit; }
    .status { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 10px; font-size: 12px; color: var(--muted, #6b7280); border-bottom: 1px solid var(--line, #dddddf); }
    .status .ai { color: #4f46e5; font-weight: 600; }
    .status .error { color: #b42318; }
    .status button { margin-left: auto; font-size: 12px; border: 1px solid var(--line, #dddddf); border-radius: 6px; background: #fff; padding: 2px 8px; cursor: pointer; }
    .viewport { flex: 1; min-height: 0; background: #f6f6f7; display: grid; place-items: center; color: var(--muted, #6b7280); font-size: 13px; }
  `;

  private _emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _onAddressKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = (event.target as HTMLInputElement).value.trim();
    this._editing = false;
    if (value) this._emit("browser-navigate", { url: value });
  }

  render() {
    const state = this.state;
    const owner = state?.owner ?? null;
    const url = this._editing ? this.addressDraft : state?.url ?? "";
    return html`
      <div class="toolbar" role="toolbar" aria-label="ブラウザ">
        <button type="button" title="戻る" aria-label="戻る" ?disabled=${!state?.canGoBack} @click=${() => this._emit("browser-back")}>←</button>
        <button type="button" title="進む" aria-label="進む" ?disabled=${!state?.canGoForward} @click=${() => this._emit("browser-forward")}>→</button>
        <button type="button" title="再読み込み" aria-label="再読み込み" ?disabled=${!state?.url} @click=${() => this._emit("browser-reload")}>⟳</button>
        <input
          type="text"
          aria-label="アドレス"
          placeholder="https://..."
          .value=${url}
          @focus=${() => { this._editing = true; this.addressDraft = state?.url ?? ""; }}
          @input=${(event: InputEvent) => { this.addressDraft = (event.target as HTMLInputElement).value; }}
          @blur=${() => { this._editing = false; this.requestUpdate(); }}
          @keydown=${this._onAddressKeydown}
        />
        <button type="button" title="外部ブラウザで開く" aria-label="外部ブラウザで開く" ?disabled=${!state?.url} @click=${() => this._emit("browser-open-external")}>↗</button>
        <button type="button" title="閉じる" aria-label="ブラウザを閉じる" @click=${() => this._emit("browser-close")}>✕</button>
      </div>
      <div class="status" role="status" aria-live="polite">
        ${owner?.kind === "agent"
          ? html`<span class="ai">AI が操作中${this.ownerLabel ? `（${this.ownerLabel}）` : ""}</span>
              <button type="button" @click=${() => this._emit("browser-take-control")}>手動操作に切替</button>`
          : owner?.kind === "user"
            ? html`<span>手動操作中</span><button type="button" @click=${() => this._emit("browser-allow-agent")}>AI に操作を許可</button>`
            : state?.lastOwnerConversationId && this.ownerLabel
              ? html`<span>直前の操作: ${this.ownerLabel}</span>`
              : nothing}
        ${state?.loading ? html`<span>読み込み中…</span>` : nothing}
        ${state?.error ? html`<span class="error">${state.error}</span>` : nothing}
      </div>
      <div class="viewport" part="viewport">${this.tooNarrow ? "ウィンドウを広げてください" : state?.url ? "" : "リンクを開くか、アドレスを入力してください"}</div>
    `;
  }
}
