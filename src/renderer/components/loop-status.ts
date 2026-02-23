import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { LoopState } from "../../shared/agent-loop.js";
import { createInitialLoopState } from "../../shared/agent-loop.js";

@customElement("lilt-loop-status")
export class LiltLoopStatus extends LitElement {
  @property({ type: Object }) loopState: LoopState = createInitialLoopState();

  static styles = css`
    :host {
      display: block;
      width: min(680px, calc(100% - 16px));
      box-sizing: border-box;
      margin: 0 auto;
    }
    .panel {
      border: 1px solid #dbe4ff;
      background: #f4f7ff;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      color: #1f3b73;
    }
    .panel.running {
      border-color: #cdd9ff;
      background: #f3f6ff;
      color: #223f7a;
    }
    .panel.completed {
      border-color: #b8e6c8;
      background: #f0fff4;
      color: #17603a;
    }
    .panel.failed {
      border-color: #f5c6c6;
      background: #fff5f5;
      color: #8f2323;
    }
    .title {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .tool-chip {
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #b7c9ff;
      background: #ffffff;
      font-family: "SF Mono", "Menlo", "Consolas", monospace;
      font-size: 12px;
      color: #294c8c;
    }
  `;

  render() {
    if (this.loopState.status === "idle") {
      return html``;
    }

    const statusClass = this.loopState.status;
    const title =
      this.loopState.status === "running"
        ? "エージェント実行中"
        : this.loopState.status === "completed"
          ? "実行完了"
          : "実行失敗";

    return html`
      <div class="panel ${statusClass}" data-loop-status=${this.loopState.status}>
        <div class="title">${title}</div>
        ${this.loopState.lastError ? html`<div>${this.loopState.lastError}</div>` : html``}
        ${this.loopState.activeTools.length > 0
          ? html`
              <div>実行中ツール:</div>
              <div class="tools">
                ${this.loopState.activeTools.map(
                  (tool) => html`<span class="tool-chip" data-tool-call-id=${tool.toolCallId}>${tool.toolName}</span>`
                )}
              </div>
            `
          : this.loopState.status === "running"
            ? html`<div>ツール実行待機中...</div>`
            : html``}
      </div>
    `;
  }
}
