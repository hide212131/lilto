const assert = require("node:assert/strict");
const http = require("node:http");
const { chromium } = require("playwright-core");
const { resolveNamedLocator } = require("./electron-playwright");

async function verifyLinkNavigation(browser, page, port, screenshotPath) {
  const server = http.createServer((request, response) => {
    if (request.url === "/offline") { request.socket.destroy(); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<h1>${request.url === "/second" ? "Second page" : "First page"}</h1><a href="/second">Next page</a><a href="/offline">Offline page</a>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/first`;
  const originalUrl = page.url();
  page.setDefaultTimeout(10000);
  const input = resolveNamedLocator(page, "composerInput");
  const draft = await input.inputValue();
  await input.fill("リンクから戻った後も残る下書き");
  const addLink = async (target) => {
    await page.evaluate(({ url, target }) => {
      document.querySelector("#navigation-fixture")?.remove();
      const link = document.createElement("a");
      link.id = "navigation-fixture";
      link.href = url;
      link.target = target;
      link.textContent = "Navigation fixture";
      link.style = "position:fixed;top:0;left:0;z-index:99999;background:white";
      document.body.append(link);
    }, { url, target });
    await page.locator("#navigation-fixture").click({ noWaitAfter: true });
  };
  const findPage = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const match = browser.contexts().flatMap((context) => context.pages()).find(predicate);
      if (match) { match.setDefaultTimeout(10000); return match; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Link view did not appear");
  };
  try {
    await addLink("");
    let content = await findPage((candidate) => candidate.url() === url);
    let toolbar = await findPage((candidate) => candidate.url().startsWith("data:text/html"));
    await content.getByRole("heading", { name: "First page" }).waitFor();
    assert.equal(await content.evaluate(() => typeof window.lilto), "undefined");
    await content.getByRole("link", { name: "Next page" }).click();
    await content.getByRole("heading", { name: "Second page" }).waitFor();
    await toolbar.getByRole("button", { name: "← 戻る", exact: true }).click({ noWaitAfter: true });
    await content.getByRole("heading", { name: "First page" }).waitFor();
    if (screenshotPath) {
      // CDP captures each WebContents separately; keep both views as visual evidence.
      await toolbar.screenshot({ path: screenshotPath.replace(/\.png$/, "-toolbar.png") });
      await content.screenshot({ path: screenshotPath });
    }
    // Electron cancels the host navigation in will-navigate. Reconnect CDP to
    // discard Playwright's pending navigation bookkeeping for host and toolbar.
    await browser.close();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url() === originalUrl);
    toolbar = await findPage((candidate) => candidate.url().startsWith("data:text/html"));
    await toolbar.getByRole("button", { name: "← 戻る", exact: true }).click({ noWaitAfter: true });
    assert.equal(await resolveNamedLocator(page, "composerInput").inputValue(), "リンクから戻った後も残る下書き");
    assert.equal(page.url(), originalUrl);
    // target=_blank must have the same return path, rather than an unmanaged window.
    await addLink("_blank");
    content = await findPage((candidate) => candidate.url() === url);
    toolbar = await findPage((candidate) => candidate.url().startsWith("data:text/html"));
    await content.getByRole("heading", { name: "First page" }).waitFor();
    await content.getByRole("link", { name: "Offline page" }).click({ noWaitAfter: true });
    await toolbar.getByRole("button", { name: "チャットに戻る", exact: true }).waitFor();
    await toolbar.getByRole("button", { name: "チャットに戻る", exact: true }).click({ noWaitAfter: true });
    assert.equal(await resolveNamedLocator(page, "composerInput").inputValue(), "リンクから戻った後も残る下書き");
    assert.equal(page.url(), originalUrl);
    console.log("✓ Link navigation: isolated content, multi-page back, return to chat, popup, offline recovery, preserved draft");
    return { browser, page };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await page.evaluate(() => document.querySelector("#navigation-fixture")?.remove()).catch(() => {});
    await resolveNamedLocator(page, "composerInput").fill(draft, { timeout: 3000 }).catch(() => {});
  }
}

module.exports = { verifyLinkNavigation };
if (require.main === module) {
  (async () => {
    let browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`);
    try {
      const page = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().startsWith("file:"));
      ({ browser } = await verifyLinkNavigation(browser, page, process.argv[2], "test/artifacts/link-navigation.png"));
    } finally {
      await browser.close();
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
