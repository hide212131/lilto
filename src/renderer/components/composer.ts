import { LitElement, html, css } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { AudioRecorder } from "../audio-recorder.js";

@customElement("lilt-composer")
export class LiltComposer extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) isSending = false;
  @property({ type: Boolean }) enterToSend = false;

  @state() private _dictationStatus = "";
  @state() private _dictationStatusKind: "idle" | "active" | "error" = "idle";
  @state() private _isRecording = false;
  @state() private _isTranscribing = false;
  @state() private _recordingLevel = 0;

  @query("textarea") private _textarea!: HTMLTextAreaElement;
  @query(".btn-dictation") private _dictationButton!: HTMLButtonElement;

  private _isComposing = false;
  private _compositionEndAt = 0;
  private _lastSentText = "";
  private _recorder: AudioRecorder | null = null;
  private readonly _platform = window.lilto.getPlatform();

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
    .hint-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      flex: 1;
    }
    .dictation-status {
      min-height: 20px;
      font-size: 13px;
      color: var(--muted, #6b7280);
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .dictation-status[data-kind="active"] {
      color: #0f766e;
      font-weight: 600;
    }
    .dictation-status[data-kind="error"] {
      color: #b91c1c;
    }
    .meter {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      height: 18px;
      flex-shrink: 0;
    }
    .meter-bar {
      width: 3px;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.3;
      transition: height 0.08s linear, opacity 0.08s linear;
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
    .btn-dictation {
      min-width: 42px;
      padding: 8px 12px;
      background: #fff;
      color: var(--accent, #111827);
      border-color: var(--line, #d1d5db);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-dictation[data-active="true"] {
      background: #ecfeff;
      border-color: #0f766e;
      color: #0f766e;
    }
    .btn-dictation svg {
      width: 18px;
      height: 18px;
      display: block;
    }
  `;

  render() {
    const hint = this.enterToSend ? "Enter で送信 / Shift+Enter で改行" : "Cmd/Ctrl + Enter で送信";
    const active = this._isRecording || this._isTranscribing;
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
            <div class="hint-block">
              <span class="hint">${hint}</span>
              <span class="dictation-status" data-kind=${this._dictationStatusKind}>
                ${active ? this._renderLevelMeter() : null}
                <span>${this._dictationStatus || " "}</span>
              </span>
            </div>
            <div class="btn-group">
              <button
                class="btn-dictation"
                title="長押しで音声入力"
                aria-label="長押しで音声入力"
                ?disabled=${this.disabled || this.isSending || this._isTranscribing}
                data-active=${String(active)}
                @pointerdown=${this._onDictationPointerDown}
                @pointerup=${this._onDictationPointerUp}
                @pointercancel=${this._onDictationPointerCancel}
                @lostpointercapture=${this._onDictationPointerUp}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    fill="currentColor"
                    d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 1 0 10 0Z"
                  ></path>
                </svg>
              </button>
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

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("blur", this._onWindowBlur);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("blur", this._onWindowBlur);
    void this._cancelRecording();
  }

  protected updated(): void {
    if ((this.disabled || this.isSending) && (this._isRecording || this._isTranscribing || this._dictationStatusKind !== "idle")) {
      void this._cancelRecording();
    }
  }

  private _renderLevelMeter() {
    return html`
      <span class="meter" aria-hidden="true">
        ${Array.from({ length: 20 }, (_, index) => {
          const offset = Math.abs(index - 9.5);
          const level = Math.max(0.2, this._recordingLevel * (1 - offset / 12));
          const height = this._isTranscribing
            ? 6 + (index % 4) * 2
            : 4 + Math.round(level * 18);
          const opacity = this._isTranscribing ? 0.65 : 0.25 + Math.min(0.75, level);
          return html`<span class="meter-bar" style=${`height:${height}px;opacity:${opacity};`}></span>`;
        })}
      </span>
    `;
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
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        return;
      }
    }

    if (e.key === "Enter") {
      const isComposing = this._isComposing || Date.now() - this._compositionEndAt < 20;
      if (isComposing) return;

      if (this.enterToSend) {
        if (!e.shiftKey) {
          e.preventDefault();
          this._onSend();
        }
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        this._onSend();
      }
    }
  }

  private _onAbort() {
    void this._cancelRecording();
    this.dispatchEvent(new CustomEvent("abort-request", { bubbles: true, composed: true }));
  }

  private _onSend() {
    if (this.disabled || this.isSending) return;
    void this._cancelRecording();
    const text = this._textarea.value.trim();
    if (!text) return;
    this._lastSentText = text;
    this.dispatchEvent(new CustomEvent("send-message", {
      detail: { text },
      bubbles: true,
      composed: true
    }));
    this._textarea.value = "";
  }

  private _onWindowBlur = () => {
    void this._cancelRecording();
  };

  private _onDictationPointerDown = (event: PointerEvent) => {
    if (this.disabled || this.isSending || this._isTranscribing || this._isRecording) {
      return;
    }
    event.preventDefault();
    this.focusInput();
    this._dictationButton?.setPointerCapture(event.pointerId);
    void this._startRecording();
  };

  private _onDictationPointerUp = (event: PointerEvent) => {
    event.preventDefault();
    if (this._dictationButton?.hasPointerCapture(event.pointerId)) {
      this._dictationButton.releasePointerCapture(event.pointerId);
    }
    void this._stopRecordingAndTranscribe();
  };

  private _onDictationPointerCancel = (event: PointerEvent) => {
    event.preventDefault();
    if (this._dictationButton?.hasPointerCapture(event.pointerId)) {
      this._dictationButton.releasePointerCapture(event.pointerId);
    }
    void this._cancelRecording();
  };

  private async _startRecording(): Promise<void> {
    this._dictationStatus = "";
    this._dictationStatusKind = "idle";
    this._recordingLevel = 0;

    if (this._platform === "win32") {
      const result = await window.lilto.startNativeDictation();
      if (!result.ok) {
        this._dictationStatus = result.error.message;
        this._dictationStatusKind = "error";
        return;
      }

      this._isRecording = true;
      this._dictationStatus = "Listening...";
      this._dictationStatusKind = "active";
      return;
    }

    try {
      this._recorder = new AudioRecorder({
        onLevel: (level) => {
          this._recordingLevel = level;
        }
      });
      await this._recorder.start();
      this._isRecording = true;
      this._dictationStatus = "録音中...";
      this._dictationStatusKind = "active";
    } catch (error) {
      this._recorder = null;
      this._isRecording = false;
      this._recordingLevel = 0;
      this._dictationStatus = error instanceof Error ? error.message : "マイク入力を開始できませんでした。";
      this._dictationStatusKind = "error";
    }
  }

  private async _stopRecordingAndTranscribe(): Promise<void> {
    if (this._platform === "win32") {
      if (!this._isRecording) {
        return;
      }

      this._isRecording = false;
      this._isTranscribing = true;
      this._dictationStatus = "Transcribing...";
      this._dictationStatusKind = "active";

      try {
        const result = await window.lilto.finishNativeDictation();
        if (!result.ok) {
          this._dictationStatus = result.error.message;
          this._dictationStatusKind = "error";
          return;
        }

        this._appendTranscribedText(result.text);
        this._dictationStatus = "";
        this._dictationStatusKind = "idle";
      } catch (error) {
        this._dictationStatus = error instanceof Error ? error.message : "Transcription failed.";
        this._dictationStatusKind = "error";
      } finally {
        this._isTranscribing = false;
        this._recordingLevel = 0;
      }
      return;
    }

    if (!this._recorder || !this._isRecording) {
      return;
    }

    this._isRecording = false;
    this._isTranscribing = true;
    this._dictationStatus = "文字起こし中...";
    this._dictationStatusKind = "active";

    const recorder = this._recorder;
    this._recorder = null;

    try {
      const wavData = await recorder.stop();
      const result = await window.lilto.transcribeAudio(wavData);
      if (!result.ok) {
        this._dictationStatus = result.error.message;
        this._dictationStatusKind = "error";
        return;
      }

      this._appendTranscribedText(result.text);
      this._dictationStatus = "";
      this._dictationStatusKind = "idle";
    } catch (error) {
      this._dictationStatus = error instanceof Error ? error.message : "文字起こしに失敗しました。";
      this._dictationStatusKind = "error";
    } finally {
      this._isTranscribing = false;
      this._recordingLevel = 0;
    }
  }

  private async _cancelRecording(): Promise<void> {
    if (this._platform === "win32") {
      this._isRecording = false;
      this._isTranscribing = false;
      this._recordingLevel = 0;
      await window.lilto.cancelNativeDictation();
      if (this._dictationStatusKind === "active") {
        this._dictationStatus = "";
        this._dictationStatusKind = "idle";
      }
      return;
    }

    if (!this._recorder) {
      this._isRecording = false;
      this._isTranscribing = false;
      this._recordingLevel = 0;
      if (this._dictationStatusKind === "active") {
        this._dictationStatus = "";
        this._dictationStatusKind = "idle";
      }
      return;
    }

    const recorder = this._recorder;
    this._recorder = null;
    this._isRecording = false;
    this._isTranscribing = false;
    this._recordingLevel = 0;
    await recorder.discard();
    if (this._dictationStatusKind === "active") {
      this._dictationStatus = "";
      this._dictationStatusKind = "idle";
    }
  }

  private _appendTranscribedText(text: string): void {
    const nextText = text.trim();
    if (!nextText) {
      return;
    }

    const current = this._textarea.value.trimEnd();
    this._textarea.value = current ? `${current} ${nextText}` : nextText;
    this._textarea.selectionStart = this._textarea.selectionEnd = this._textarea.value.length;
    this.focusInput();
  }
}
