const assert = require("node:assert/strict");

async function verifyConversationHistory(page, fixtureId, count = 1000) {
  const snapshot = await page.evaluate(async ({ id }) => {
    const app = document.querySelector("lilt-app");
    window.__historySnapshot = { sessions: app.sessions, messages: app.messages, active: app.activeSessionId };
    app.sessions = [...app.sessions, { id, title: "Long conversation", messages: [], createdAt: 1, updatedAt: 1 }];
    await app._openConversation(id);
    await app.updateComplete;
    const list = app.shadowRoot.querySelector("lilt-message-list");
    window.__historySnapshot.showToolExecutionDetails = list.showToolExecutionDetails;
    await list.updateComplete;
    const chat = list.shadowRoot.querySelector(".chat");
    return { messages: app.messages.map((message) => message.text), bottomGap: chat.scrollHeight - chat.scrollTop - chat.clientHeight };
  }, { id: fixtureId });
  const list = page.locator("lilt-message-list");
  const chat = list.locator(".chat");
  const state = () => page.evaluate(() => {
    const app = document.querySelector("lilt-app");
    const list = app.shadowRoot.querySelector("lilt-message-list");
    return { count: app.messages.length, dom: list.shadowRoot.querySelectorAll(".msg").length,
      first: app.messages[0]?.text, last: app.messages.at(-1)?.text, newer: list.hasNewer };
  });
  const idle = () => page.waitForFunction(() => !document.querySelector("lilt-app")._historyLoading);
  try {
    assert.equal(snapshot.messages.length, 40);
    assert.equal(snapshot.messages[0], `History question ${count - 20}`);
    assert.equal(snapshot.messages.at(-1), `History answer ${count - 1}`);
    assert.ok(snapshot.bottomGap < 2);

    // Real wheel scrolling triggers the first older request.
    await chat.hover();
    await page.mouse.wheel(0, -100000);
    await page.waitForFunction(() => document.querySelector("lilt-app").messages.length === 80);
    await idle();

    // Inserting a page preserves the first visible message and pixel offset.
    await chat.evaluate((element) => { element.scrollTop = 400; });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const anchorBefore = await chat.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const anchor = [...element.querySelectorAll("[data-message-id]")].find((entry) => entry.getBoundingClientRect().bottom > top);
      return { id: anchor.dataset.messageId, offset: anchor.getBoundingClientRect().top - top };
    });
    // A completed reply's history refresh must also keep the older page when
    // the latest page is still retained (hasNewer is false at this point).
    await page.evaluate(async () => {
      const app = document.querySelector("lilt-app");
      await app._refreshConversation(app.activeSessionId);
    });
    assert.equal((await state()).count, 80);

    // Dispatch the same UI event without moving focus/scroll to the top button.
    await list.evaluate((element) => element._loadHistory("older"));
    await page.waitForFunction(() => document.querySelector("lilt-app").messages.length === 120);
    await idle();
    const offsetAfter = await chat.evaluate((element, id) => {
      const anchor = [...element.querySelectorAll("[data-message-id]")].find((entry) => entry.dataset.messageId === id);
      return anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
    }, anchorBefore.id);
    assert.ok(Math.abs(offsetAfter - anchorBefore.offset) < 2, `Scroll anchor moved by ${offsetAfter - anchorBefore.offset}px`);

    for (let i = 0; i < 2; i += 1) {
      const previous = (await state()).first;
      await list.locator(".history-older").click();
      await page.waitForFunction((first) => document.querySelector("lilt-app").messages[0]?.text !== first, previous);
      await idle();
      const current = await state();
      assert.ok(current.count <= 120);
      assert.equal(current.dom, current.count);
    }
    assert.equal((await state()).newer, true);
    assert.equal((await state()).first, `History question ${count - 100}`);

    const failed = await page.evaluate(async () => {
      const app = document.querySelector("lilt-app");
      const window = app._historyWindow;
      const cursor = window.cursor;
      const before = app.messages.map((message) => message.id);
      window.cursor = (direction) => direction === "older" ? "invalid-cursor" : cursor.call(window, direction);
      try { await app._onLoadHistory(new CustomEvent("load-history", { detail: { direction: "older" } })); }
      finally { window.cursor = cursor; app.requestUpdate(); }
      return { error: app._historyError, unchanged: JSON.stringify(before) === JSON.stringify(app.messages.map((message) => message.id)) };
    });
    assert.ok(failed.error.includes("履歴を読み込めませんでした"));
    assert.equal(failed.unchanged, true);
    const beforeRetry = (await state()).first;
    await list.locator(".history-older").click();
    await page.waitForFunction((first) => document.querySelector("lilt-app").messages[0]?.text !== first, beforeRetry);
    await idle();
    assert.equal(await list.locator(".history-error").count(), 0);

    // Freed newer pages are reachable again with normal scrolling.
    const previousLast = (await state()).last;
    await chat.hover();
    await page.mouse.wheel(0, 100000);
    await page.waitForFunction((last) => document.querySelector("lilt-app").messages.at(-1)?.text !== last, previousLast);
    await idle();
    assert.ok((await state()).count <= 120);

    // Keep reading old content while an unrelated UI update occurs.
    await chat.evaluate((element) => { element.scrollTop = 500; });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const before = await chat.evaluate((element) => element.scrollTop);
    await list.evaluate(async (element) => { element.showToolExecutionDetails = !element.showToolExecutionDetails; await element.updateComplete; });
    assert.ok(Math.abs((await chat.evaluate((element) => element.scrollTop)) - before) < 2);
    await page.evaluate(async () => {
      const app = document.querySelector("lilt-app");
      await app._refreshConversation(app.activeSessionId, true);
      await app.updateComplete;
      await app.shadowRoot.querySelector("lilt-message-list").updateComplete;
    });
    assert.equal((await state()).count, 40);
    assert.equal((await state()).last, `History answer ${count - 1}`);
    assert.ok(await chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight < 2));
    const cancelled = await page.evaluate(async () => {
      const app = document.querySelector("lilt-app");
      const pending = app._onLoadHistory(new CustomEvent("load-history", { detail: { direction: "older" } }));
      // Sending invalidates navigation without changing the selected session.
      ++app._navigationVersion;
      await pending;
      return app._historyLoading;
    });
    assert.equal(cancelled, false);
    const navigation = await page.evaluate(async () => {
      const app = document.querySelector("lilt-app");
      const pending = app._onLoadHistory(new CustomEvent("load-history", { detail: { direction: "older" } }));
      app._onStartNewSession();
      await pending;
      return { count: app.messages.length, active: app.activeSessionId, cursor: app._historyWindow.cursor("older") };
    });
    assert.deepEqual(navigation, { count: 0, active: null, cursor: null });
    console.log("✓ 1,000-turn history starts at the latest page; scrolling pages both ways, retains at most 60 turns, and preserves the reading position");
  } finally {
    await page.evaluate(async () => {
      const app = document.querySelector("lilt-app");
      const snapshot = window.__historySnapshot;
      app.sessions = snapshot.sessions;
      app.messages = snapshot.messages;
      app._activateSession(snapshot.active);
      app.requestUpdate();
      await app.updateComplete;
      const list = app.shadowRoot.querySelector("lilt-message-list");
      list.showToolExecutionDetails = snapshot.showToolExecutionDetails;
      await list.updateComplete;
      delete window.__historySnapshot;
    });
  }
}

module.exports = { verifyConversationHistory };
