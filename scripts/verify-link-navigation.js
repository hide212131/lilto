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
  // The toolbar is a Lit component in the host page (no longer a separate view); Playwright pierces open shadow roots.
  const panel = () => page.locator("lilt-browser-panel");
  const toolbarButton = (name) => panel().getByRole("button", { name, exact: true });
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
    throw new Error("Embedded browser page did not appear");
  };
  try {
    await addLink("");
    let content = await findPage((candidate) => candidate.url() === url);
    await content.getByRole("heading", { name: "First page" }).waitFor();
    assert.equal(await content.evaluate(() => typeof window.lilto), "undefined");
    // Electron cancels the host navigation in will-navigate, and Playwright keeps
    // "pending navigation" bookkeeping for the host page: host-page locators
    // (panel visibility, bounding boxes) stall until it is discarded. Reconnect
    // CDP first, re-find both pages, and only then assert on the host page.
    await browser.close();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url() === originalUrl);
    page.setDefaultTimeout(10000);
    content = await findPage((candidate) => candidate.url() === url);
    await panel().waitFor();
    // The native page must sit exactly over the panel's viewport placeholder (never over chat or toolbar).
    const placeholder = await panel().locator(".viewport").boundingBox();
    const size = await content.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    assert.ok(Math.abs(size.width - placeholder.width) <= 2 && Math.abs(size.height - placeholder.height) <= 2, `page ${JSON.stringify(size)} vs viewport ${JSON.stringify(placeholder)}`);
    assert.equal(await resolveNamedLocator(page, "composerInput").inputValue(), "リンクから戻った後も残る下書き");
    assert.equal(page.url(), originalUrl);
    await content.getByRole("link", { name: "Next page" }).click();
    await content.getByRole("heading", { name: "Second page" }).waitFor();
    await toolbarButton("戻る").click({ noWaitAfter: true });
    await content.getByRole("heading", { name: "First page" }).waitFor();
    if (screenshotPath) {
      // CDP captures each WebContents separately: host (panel chrome) and page are both kept as evidence.
      await page.screenshot({ path: screenshotPath.replace(/\.png$/, "-host.png") });
      await content.screenshot({ path: screenshotPath });
    }
    // target=_blank must land in the same panel, not an unmanaged window.
    const pagesBefore = browser.contexts().flatMap((context) => context.pages()).length;
    await addLink("_blank");
    content = await findPage((candidate) => candidate.url() === url);
    await content.getByRole("heading", { name: "First page" }).waitFor();
    assert.equal(browser.contexts().flatMap((context) => context.pages()).filter((candidate) => candidate.url() === url).length, 1);
    assert.ok(browser.contexts().flatMap((context) => context.pages()).length <= pagesBefore + 1, "no extra windows for _blank");
    await content.getByRole("link", { name: "Offline page" }).click({ noWaitAfter: true });
    await panel().getByText("読み込みに失敗しました").waitFor();
    // Failure keeps the toolbar usable: back to the previous page, then close the panel to return to chat.
    await toolbarButton("戻る").waitFor();
    await toolbarButton("ブラウザを閉じる").click({ noWaitAfter: true });
    await panel().waitFor({ state: "detached" });
    assert.equal(await resolveNamedLocator(page, "composerInput").inputValue(), "リンクから戻った後も残る下書き");
    assert.equal(page.url(), originalUrl);
    console.log("✓ Link navigation: isolated content in right panel, aligned viewport, multi-page back, popup, offline recovery, close, preserved draft");
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
