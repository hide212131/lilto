const assert = require("node:assert/strict");

async function verifyConversationSteering(page) {
  const composer = page.locator("lilt-composer");
  const input = composer.locator("textarea");
  await input.fill("E2E steering original");
  await composer.getByRole("button", { name: "送信", exact: true }).click();
  const steerButton = composer.getByRole("button", { name: "追加指示を送信", exact: true });
  await steerButton.waitFor({ state: "visible" });
  assert.equal(await input.isEnabled(), true);
  await input.fill("先にテストを確認して");
  await steerButton.click();
  await input.fill("回答は短くして");
  await input.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await page.waitForFunction(() => !document.querySelector("lilt-app").isSending);
  const messages = await page.evaluate(() => document.querySelector("lilt-app").messages.map(({ role, text, pending }) => ({ role, text, pending })));
  assert.deepEqual(messages.filter((message) => message.role === "user").map((message) => message.text), [
    "E2E steering original", "先にテストを確認して", "回答は短くして"
  ]);
  const answers = messages.filter((message) => message.role === "assistant");
  assert.equal(answers.length, 1);
  assert.match(answers[0].text, /追加指示: 先にテストを確認して \/ 回答は短くして/);
  assert.equal(answers[0].pending, false);
  assert.equal(messages.at(-1).role, "assistant");

  // Exercise the completion race through the real IPC endpoint: the renderer
  // still shows a running turn although the backend has already completed it.
  await page.evaluate(() => {
    const app = document.querySelector("lilt-app");
    app._conversationRuns.set(app._currentSessionId, {
      conversationId: app._currentSessionId, pendingAssistantMessageId: "completed-race",
      requestId: null, responseReceived: false, toolCallIds: new Set(), statusLines: [],
      thinkingText: "", toolProgress: [], pendingLabel: "", loopState: app.loopState
    });
    app.isSending = true;
  });
  await input.fill("終了直後の追加指示");
  await steerButton.click();
  await page.waitForFunction(() => {
    const app = document.querySelector("lilt-app");
    return app.messages.some((message) => message.role === "error" && message.text.includes("追加指示を送信できませんでした"));
  });
  assert.equal(await input.inputValue(), "終了直後の追加指示");
  await page.evaluate(() => {
    const app = document.querySelector("lilt-app");
    app.isSending = false;
    app._conversationRuns.delete(app._currentSessionId);
  });
  await input.fill("");

  await input.fill("E2E abort after steering");
  await composer.getByRole("button", { name: "送信", exact: true }).click();
  await steerButton.waitFor({ state: "visible" });
  await input.fill("この処理は中断予定");
  await steerButton.click();
  await composer.getByRole("button", { name: "中断", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("lilt-app").isSending);
  const late = await page.evaluate(() => {
    const app = document.querySelector("lilt-app");
    return window.lilto.steerPrompt("停止後", app._currentSessionId);
  });
  assert.equal(late.ok, false);
  assert.equal(late.error.code, "NO_ACTIVE_TURN");
  console.log("✓ In-flight button/keyboard steering, message order, failed-send draft recovery, and abort");
}

module.exports = { verifyConversationSteering };
