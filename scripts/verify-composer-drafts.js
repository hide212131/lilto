const assert = require("node:assert/strict");
const { resolveNamedLocator } = require("./electron-playwright");

// The full E2E checks session switching; the dedicated restart runner supplies
// a callback that exits and relaunches Electron with the same profile.
async function verifyComposerDrafts(initialPage, restart = async (page) => page) {
  let page = initialPage;
  const input = () => resolveNamedLocator(page, "composerInput");
  const newSession = () => resolveNamedLocator(page, "newSessionButton").click();
  const ids = {};
  const select = async (title) => {
    const id = ids[title];
    await page.evaluate(() => { document.querySelector("lilt-app").sidebarOpen = true; });
    const index = await page.evaluate((id) => document.querySelector("lilt-app").sessions.findIndex((s) => s.id === id), id);
    assert.ok(index >= 0, `Missing conversation ${id}`);
    await page.locator("lilt-chat-history .session-item").nth(index).click();
    await page.waitForFunction((expected) => {
      const app = document.querySelector("lilt-app");
      return app.activeSessionId === expected;
    }, id);
  };
  const expectDraft = async (text) => {
    await page.waitForFunction((expected) => document.querySelector("lilt-app")?.shadowRoot
      ?.querySelector("lilt-composer")?.shadowRoot?.querySelector("textarea")?.value === expected, text);
    assert.equal(await input().inputValue(), text);
  };
  for (const title of ["draft regression A", "draft regression B"]) {
    await newSession();
    await input().fill(title);
    await resolveNamedLocator(page, "composerSend").click();
    await page.waitForFunction(() => {
      const app = document.querySelector("lilt-app");
      return !app.isSending && app.activeSessionId;
    });
    await expectDraft("");
    ids[title] = await page.evaluate(() => document.querySelector("lilt-app").activeSessionId);
  }
  await newSession();
  await input().fill("新規チャットの下書き");
  await select("draft regression A");
  await expectDraft("");
  const draftA = "  セッションA 日本語\n未送信の続き  ";
  await input().fill(draftA);
  await select("draft regression B");
  await expectDraft("");
  await input().fill("セッションBの下書き");
  page = await restart(page);
  await expectDraft("セッションBの下書き");
  await select("draft regression A");
  await expectDraft(draftA);
  await newSession();
  await expectDraft("新規チャットの下書き");
  page = await restart(page);
  await expectDraft("新規チャットの下書き");
  await input().fill("");
  page = await restart(page);
  await expectDraft("");
  await select("draft regression B");
  await expectDraft("セッションBの下書き");
  await resolveNamedLocator(page, "composerSend").click();
  await page.waitForFunction(() => !document.querySelector("lilt-app").isSending);
  page = await restart(page);
  await expectDraft("");
  await newSession();
  console.log("✓ Session-specific drafts, Japanese/multiline text, new chat, clear and send persistence");
  return page;
}
module.exports = { verifyComposerDrafts };
