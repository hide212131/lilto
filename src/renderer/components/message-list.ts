import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import type { Message } from "../types.js";

@customElement("lilt-message-list")
export class LiltMessageList extends LitElement {
  @property({ type: Array }) messages: Message[] = [];
  private static readonly THINKING_PREVIEW_LINES = 24;
  private static readonly TOOL_PREVIEW_LINES = 16;
  private _expandedThinkingById = new Set<string>();
  private _expandedThinkingMoreById = new Set<string>();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .chat {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 16px 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    .msg {
      width: min(680px, calc(100% - 16px));
      box-sizing: border-box;
      padding: 10px 14px;
      border-radius: 10px;
      line-height: 1.5;
      font-size: 14px;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    .msg-user {
      margin-left: auto;
      margin-right: 0;
      align-self: flex-end;
      background: #faf6f2;
      border: 1px solid #f0d8c5;
      width: fit-content;
      max-width: min(680px, calc(100% - 16px));
    }
    .msg-assistant {
      margin-right: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      white-space: normal;
    }
    .msg-system {
      margin-right: auto;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      color: #374151;
    }
    .msg-error {
      margin-right: auto;
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #7f1d1d;
    }
    .msg-pending {
      opacity: 0.8;
    }
    .assistant-progress {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
    }
    .assistant-status {
      font-size: 12px;
      color: #4b5563;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    .tool-label {
      font-size: 13px;
      color: #6b7280;
      font-style: italic;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    .thinking-block {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      overflow: hidden;
    }
    .thinking-summary {
      cursor: pointer;
      list-style: none;
      font-size: 12px;
      color: #4b5563;
      padding: 8px 10px;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .thinking-summary.pending {
      background: linear-gradient(90deg, #6b7280 0%, #111827 50%, #6b7280 100%);
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: thinking-shimmer 2s ease-in-out infinite;
    }
    .thinking-main {
      border-top: 1px solid #e5e7eb;
    }
    .thinking-body {
      margin: 0;
      padding: 10px;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      color: #374151;
      max-height: 180px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .thinking-more,
    .tool-more {
      border-top: 1px solid #e5e7eb;
      background: #fff;
    }
    .thinking-more > summary,
    .tool-more > summary {
      cursor: pointer;
      list-style: none;
      font-size: 12px;
      color: #4b5563;
      padding: 8px 10px;
      user-select: none;
    }
    .tool-block {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
    }
    .tool-header {
      font-size: 12px;
      color: #374151;
      padding: 7px 10px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 600;
    }
    .tool-console {
      margin: 0;
      padding: 6px 10px;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      color: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      max-height: 180px;
      overflow: auto;
      background: #ffffff;
    }
    .tool-console-compact {
      padding-top: 2px;
      padding-bottom: 2px;
      line-height: 1.25;
    }
    .assistant-answer {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #e5e7eb;
    }
    .markdown {
      line-height: 1.6;
    }
    .markdown p {
      margin: 0 0 8px;
    }
    .markdown p:last-child {
      margin-bottom: 0;
    }
    .markdown h1, .markdown h2, .markdown h3,
    .markdown h4, .markdown h5, .markdown h6 {
      margin: 12px 0 6px;
      font-weight: 600;
      line-height: 1.3;
    }
    .markdown h1 { font-size: 1.4em; }
    .markdown h2 { font-size: 1.2em; }
    .markdown h3 { font-size: 1.05em; }
    .markdown ul, .markdown ol {
      margin: 0 0 8px;
      padding-left: 20px;
    }
    .markdown li {
      margin-bottom: 2px;
    }
    .markdown code {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .markdown pre {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px;
      overflow-x: auto;
      margin: 0 0 8px;
    }
    .markdown pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 12px;
    }
    .markdown blockquote {
      margin: 0 0 8px;
      padding: 4px 12px;
      border-left: 3px solid #d1d5db;
      color: #6b7280;
    }
    .markdown a {
      color: #2563eb;
      text-decoration: underline;
    }
    .markdown table {
      border-collapse: collapse;
      margin-bottom: 8px;
      width: 100%;
    }
    .markdown th, .markdown td {
      border: 1px solid #e5e7eb;
      padding: 4px 8px;
    }
    .markdown th {
      background: #f9fafb;
      font-weight: 600;
    }
    .markdown hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 8px 0;
    }
    @keyframes thinking-shimmer {
      0% {
        background-position: -200% 0;
      }
      100% {
        background-position: 200% 0;
      }
    }
    @media (max-width: 720px) {
      .msg {
        width: calc(100% - 8px);
      }
    }
  `;

  updated() {
    if (this.messages.length === 0) {
      this._expandedThinkingById.clear();
      this._expandedThinkingMoreById.clear();
    }

    const chat = this.renderRoot.querySelector(".chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  private _handleThinkingToggle(messageId: string, event: Event) {
    const details = event.currentTarget as HTMLDetailsElement;
    if (details.open) {
      this._expandedThinkingById.add(messageId);
      return;
    }
    this._expandedThinkingById.delete(messageId);
  }

  private _handleThinkingMoreToggle(messageId: string, event: Event) {
    const details = event.currentTarget as HTMLDetailsElement;
    if (details.open) {
      this._expandedThinkingMoreById.add(messageId);
      return;
    }
    this._expandedThinkingMoreById.delete(messageId);
  }

  private _stateKeyForMessage(message: Message): string {
    return message.requestId ? `req:${message.requestId}` : `msg:${message.id}`;
  }

  private _renderMarkdown(text: string) {
    const html = marked.parse(text, { async: false }) as string;
    return unsafeHTML(`<div class="markdown">${html}</div>`);
  }

  private _renderAssistantBody(message: Message) {
    const progress = message.progress;
    if (!progress) {
      return message.text ? this._renderMarkdown(message.text) : html``;
    }

    const thinkingLines = progress.thinkingText ? progress.thinkingText.split("\n") : [];
    const thinkingPreview = thinkingLines.slice(0, LiltMessageList.THINKING_PREVIEW_LINES).join("\n");
    const thinkingRest = thinkingLines.slice(LiltMessageList.THINKING_PREVIEW_LINES).join("\n");
    const hasThinkingRest = thinkingLines.length > LiltMessageList.THINKING_PREVIEW_LINES;

    const hasAnswer =
      Boolean(message.text?.trim()) &&
      message.text !== "実行開始を待っています..." &&
      message.text !== "実行中...";

    const stateKey = this._stateKeyForMessage(message);

    return html`
      <div class="assistant-progress">
        ${progress.statusLines.length > 0
          ? html`<div class="assistant-status">${progress.statusLines.join("\n")}</div>`
          : ""}

        ${progress.thinkingText
          ? html`
              <details
                class="thinking-block"
                .open=${message.pending || this._expandedThinkingById.has(stateKey)}
                @toggle=${(event: Event) => this._handleThinkingToggle(stateKey, event)}
              >
                <summary class="thinking-summary ${message.pending ? "pending" : ""}">Thinking...</summary>
                <div class="thinking-main">
                  <pre class="thinking-body">${thinkingPreview}</pre>
                  ${hasThinkingRest
                    ? html`
                        <details
                          class="thinking-more"
                          .open=${this._expandedThinkingMoreById.has(stateKey)}
                          @toggle=${(event: Event) => this._handleThinkingMoreToggle(stateKey, event)}
                        >
                          <summary>残り ${thinkingLines.length - LiltMessageList.THINKING_PREVIEW_LINES} 行を表示</summary>
                          <pre class="thinking-body">${thinkingRest}</pre>
                        </details>
                      `
                    : ""}
                </div>
              </details>
            `
          : ""}

        ${progress.tools.map(
          (tool) => {
            const commandText = tool.detail ? `> ${tool.detail}` : "(詳細なし)";
            const toolLines = commandText.split("\n");
            const toolPreview = toolLines.slice(0, LiltMessageList.TOOL_PREVIEW_LINES).join("\n");
            const toolRest = toolLines.slice(LiltMessageList.TOOL_PREVIEW_LINES).join("\n");
            const hasToolRest = toolLines.length > LiltMessageList.TOOL_PREVIEW_LINES;
            const isCompact = toolLines.length <= 1;

            return html`
              ${tool.label ? html`<div class="tool-label">${tool.label}</div>` : ""}
              <div class="tool-block">
                <div class="tool-header">Running command: ${tool.toolName}</div>
                <pre class="tool-console ${isCompact ? "tool-console-compact" : ""}">${toolPreview}</pre>
                ${hasToolRest
                  ? html`
                      <details class="tool-more">
                        <summary>残り ${toolLines.length - LiltMessageList.TOOL_PREVIEW_LINES} 行を表示</summary>
                        <pre class="tool-console ${toolRest.includes("\n") ? "" : "tool-console-compact"}">${toolRest}</pre>
                      </details>
                    `
                  : ""}
              </div>
            `;
          }
        )}

        ${progress.pendingLabel ? html`<div class="tool-label">${progress.pendingLabel}</div>` : ""}
      </div>
      ${hasAnswer ? html`<div class="assistant-answer">${this._renderMarkdown(message.text!)}</div>` : ""}
    `;
  }

  render() {
    return html`
      <div class="chat" aria-live="polite">
        ${this.messages.map(
          (m) => html`<div class="msg msg-${m.role} ${m.pending ? "msg-pending" : ""}">${m.role === "assistant" ? this._renderAssistantBody(m) : this._renderMarkdown(m.text ?? "")}</div>`
        )}
      </div>
    `;
  }
}
