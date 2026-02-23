import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Message } from "../types.js";

@customElement("lilt-message-list")
export class LiltMessageList extends LitElement {
  @property({ type: Array }) messages: Message[] = [];

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
      white-space: pre-wrap;
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
    @media (max-width: 720px) {
      .msg {
        width: calc(100% - 8px);
      }
    }
  `;

  updated() {
    const chat = this.renderRoot.querySelector(".chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  render() {
    return html`
      <div class="chat" aria-live="polite">
        ${this.messages.map(
          (m) => html`<div class="msg msg-${m.role} ${m.pending ? "msg-pending" : ""}">${m.text}</div>`
        )}
      </div>
    `;
  }
}
