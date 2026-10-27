const path = require("node:path");
const assert = require("node:assert/strict");
const { connectToElectronApp, resolveNamedLocator } = require("./electron-playwright");

async function verifyParallelConversations(page) {
  const app = page.locator("lilt-app");
  const composer = app.locator("lilt-composer");
  const input = composer.locator("textarea");
  const newChat = resolveNamedLocator(page, "newSessionButton");
  const history = app.locator("lilt-chat-history");
  if (!(await page.evaluate(() => document.querySelector("lilt-app").sidebarOpen))) {
    await app.locator("lilt-top-bar").getByTitle("会話履歴").click();
  }
  async function send(text) {
    await input.fill(text);
    await composer.getByRole("button", { name: "送信", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("lilt-app").isSending);
    return page.evaluate(() => document.querySelector("lilt-app").activeSessionId);
  }
  async function select(title, id) {
    await history.locator(`.session-item[data-session-id="${id}"]`).click();
    await page.waitForFunction((id) => document.querySelector("lilt-app").activeSessionId === id, id);
  }
  await newChat.click();
  const a = await send("Parallel conversation A");
  assert.equal(await newChat.isEnabled(), true);
  await newChat.click();
  assert.equal(await composer.getByRole("button", { name: "送信", exact: true }).isEnabled(), true);
  const b = await send("Parallel conversation B");
  assert.notEqual(a, b);
  assert.equal(await page.evaluate(() => document.querySelector("lilt-app")._conversationRuns.size), 2);
  await page.waitForFunction(() => {
    const runs = [...document.querySelector("lilt-app")._conversationRuns.values()];
    return runs.length === 2 && runs.every((run) => run.requestId && run.toolProgress.length > 0);
  });
  assert.equal(await history.locator(".run-status").count(), 2);
  await page.evaluate(({ a, b }) => {
    const app = document.querySelector("lilt-app");
    const requestId = app._conversationRuns.get(a).requestId;
    app._onLoopEvent({ type: "text_delta", requestId, delta: "A isolated progress" });
    const aMessage = app.sessions.find((s) => s.id === a).messages.at(-1);
    const bMessage = app.sessions.find((s) => s.id === b).messages.at(-1);
    if (!aMessage.progress.pendingLabel.includes("A isolated progress") || bMessage.progress.pendingLabel?.includes("A isolated progress")) {
      throw new Error("Background progress was routed to the wrong conversation");
    }
  }, { a, b });
  await page.screenshot({ path: path.join(__dirname, "..", "test", "artifacts", "parallel-conversations-live.png"), fullPage: true });
  await select("Parallel conversation A", a);
  await input.fill("A only instruction");
  await composer.getByRole("button", { name: "追加指示を送信", exact: true }).click();
  await composer.getByRole("button", { name: "中断", exact: true }).click();
  await page.waitForFunction((a) => !document.querySelector("lilt-app")._conversationRuns.has(a), a);
  assert.equal(await page.evaluate((b) => document.querySelector("lilt-app")._conversationRuns.has(b), b), true);
  assert.equal(await history.locator(".run-status").count(), 1);
  await select("Parallel conversation B", b);
  await input.fill("B only instruction");
  await composer.getByRole("button", { name: "追加指示を送信", exact: true }).click();
  await select("Parallel conversation A", a);
  await page.waitForFunction(() => document.querySelector("lilt-app")._conversationRuns.size === 0);
  const first = await page.evaluate(({ a, b }) => {
    const app = document.querySelector("lilt-app");
    return { a: app.sessions.find((s) => s.id === a), b: app.sessions.find((s) => s.id === b), sending: app.isSending };
  }, { a, b });
  assert.equal(first.sending, false);
  assert.equal(await history.locator(".run-status").count(), 0);
  assert.ok(first.a.messages.some((m) => m.progress?.statusLines.includes("中断しました")));
  assert.ok(!first.a.messages.some((m) => m.text.includes("B only instruction")));
  assert.ok(first.b.messages.some((m) => m.text.includes("E2E_MOCK_FINAL") && m.text.includes("B only instruction")));
  assert.ok(!first.b.messages.some((m) => m.text.includes("A only instruction")));
  assert.equal(first.b.hasUnread, true);
  assert.ok(first.a.messages.some((m) => m.progress?.tools.length));
  assert.ok(first.b.messages.some((m) => m.progress?.tools.length));
  await select("Parallel conversation B", b);
  assert.equal(await composer.getByRole("button", { name: "送信", exact: true }).isEnabled(), true);

  await newChat.click();
  const c = await send("[E2E_MOCK_FAIL] Parallel failure C");
  await newChat.click();
  const d = await send("Parallel unaffected D");
  await page.waitForFunction((c) => !document.querySelector("lilt-app")._conversationRuns.has(c), c);
  const failure = await page.evaluate(({ c, d }) => {
    const app = document.querySelector("lilt-app");
    return { current: app.activeSessionId, sending: app.isSending, dRunning: app._conversationRuns.has(d),
      visibleErrors: app.messages.filter((m) => m.role === "error"), c: app.sessions.find((s) => s.id === c) };
  }, { c, d });
  assert.equal(failure.current, d);
  assert.equal(failure.dRunning, true);
  assert.equal(failure.sending, true);
  assert.deepEqual(failure.visibleErrors, []);
  assert.ok(failure.c.messages.some((m) => m.role === "error" && m.text.includes("E2E_MOCK_FAILURE")));
  assert.equal(await input.inputValue(), "");
  await select("Parallel failure C", c);
  assert.equal(await input.inputValue(), "[E2E_MOCK_FAIL] Parallel failure C");

  // Emulate backend completion preceding the renderer's invoke result. Send a
  // steer through real IPC, then change conversations before its failure arrives.
  await page.evaluate(() => {
    const app = document.querySelector("lilt-app");
    app._conversationRuns.set(app.activeSessionId, {
      conversationId: app.activeSessionId, pendingAssistantMessageId: "completion-race",
      requestId: null, responseReceived: false, toolCallIds: new Set(), statusLines: [],
      thinkingText: "", toolProgress: [], pendingLabel: "", loopState: app.loopState
    });
    app._syncSelectedRun();
  });
  await input.fill("C failed additional instruction");
  await page.evaluate((d) => {
    const app = document.querySelector("lilt-app");
    app.shadowRoot.querySelector("lilt-composer").shadowRoot.querySelector("button:last-child").click();
    app._conversationRuns.delete(app.activeSessionId);
    void app._openConversation(d);
  }, d);
  await page.waitForFunction((c) => localStorage.getItem(`lilto.composer-draft.v1:${c}`)?.includes("C failed additional instruction"), c);
  assert.equal(await input.inputValue(), "");
  await page.waitForFunction(() => document.querySelector("lilt-app")._conversationRuns.size === 0);
  const last = await page.evaluate(() => document.querySelector("lilt-app").messages);
  assert.ok(last.some((m) => m.text.includes("E2E_MOCK_FINAL") && m.text.includes("Parallel unaffected D")));
  assert.ok(!last.some((m) => m.role === "error" || m.text.includes("C failed additional instruction")));
  await select("Parallel failure C", c);
  assert.match(await input.inputValue(), /C failed additional instruction/);
  assert.ok((await page.evaluate(() => document.querySelector("lilt-app").messages)).some((m) => m.role === "error" && m.text.includes("追加指示を送信できませんでした")));
  await input.fill("");
  await newChat.click();
  console.log("✓ Parallel conversations: switch, new chat, isolated progress/steering/abort/completion, background failures and draft recovery");
}

module.exports = { verifyParallelConversations };
if (require.main === module) {
  (async () => {
    const { browser, page } = await connectToElectronApp(process.argv[2]);
    try { await verifyParallelConversations(page); }
    finally { await browser.close(); }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
