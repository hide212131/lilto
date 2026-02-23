type SubmitResult =
  | { ok: true; response: { text: string } }
  | { ok: false; error?: { code?: string; message?: string } };

export {};

declare global {
  interface Window {
    lilt: {
      submitPrompt: (text: string) => Promise<SubmitResult>;
    };
  }
}

const promptEl = document.getElementById("prompt") as HTMLTextAreaElement;
const sendEl = document.getElementById("send") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const outputEl = document.getElementById("output") as HTMLPreElement;

sendEl.addEventListener("click", async () => {
  const text = promptEl.value.trim();
  if (!text) {
    statusEl.textContent = "入力が空です";
    return;
  }

  statusEl.textContent = "送信中...";
  outputEl.textContent = "処理中...";

  const result = await window.lilt.submitPrompt(text);
  if (result.ok) {
    outputEl.textContent = result.response.text;
    statusEl.textContent = "完了";
    return;
  }

  const error = result.error || { code: "UNKNOWN", message: "不明なエラー" };
  outputEl.textContent = `${error.code}: ${error.message}`;
  statusEl.textContent = "エラー";
});
