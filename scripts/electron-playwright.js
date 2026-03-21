const { chromium } = require("playwright-core");

async function connectToElectronApp(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);

  try {
    const page = await waitForElectronPage(browser, timeoutMs);
    return { browser, page };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function waitForElectronPage(browser, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (!url || url.startsWith("devtools://")) {
          continue;
        }

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 1000 });
        } catch {
          // Retry until the app is stable enough to query.
        }

        return page;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Electron page within ${timeoutMs}ms`);
}

async function waitForAppReady(page, timeoutMs = 15000) {
  await resolveNamedLocator(page, "app").waitFor({ state: "attached", timeout: timeoutMs });
}

function resolveNamedLocator(page, selector) {
  switch (selector) {
    case "app":
      return page.locator("lilt-app").first();
    case "status":
      return resolveNamedLocator(page, "app").locator("lilt-top-bar").locator(".status").first();
    case "settingsButton":
      return resolveNamedLocator(page, "app").locator("lilt-top-bar").getByTitle("Settings").first();
    case "newSessionButton":
      return resolveNamedLocator(page, "app").locator("lilt-top-bar").getByTitle("New").first();
    case "settingsModal":
      return resolveNamedLocator(page, "app").locator("lilt-settings-modal").locator(".modal-backdrop.open").first();
    case "settingsClose":
      return resolveNamedLocator(page, "app").locator("lilt-settings-modal").getByTitle("Close").first();
    case "composerInput":
      return resolveNamedLocator(page, "app").locator("lilt-composer").locator("textarea").first();
    case "composerSend":
      return resolveNamedLocator(page, "app").locator("lilt-composer").getByRole("button", { name: "送信" }).first();
    case "messages":
      return resolveNamedLocator(page, "app").locator("lilt-message-list").locator(".msg");
    default:
      return page.locator(selector).first();
  }
}

async function collectMessages(page) {
  return await resolveNamedLocator(page, "messages").allTextContents();
}

module.exports = {
  collectMessages,
  connectToElectronApp,
  resolveNamedLocator,
  waitForAppReady
};
