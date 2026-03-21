const fs = require("node:fs");
const path = require("node:path");
const {
  collectMessages,
  connectToElectronApp,
  resolveNamedLocator,
  waitForAppReady
} = require("./electron-playwright");

function usage() {
  return [
    "Usage: node scripts/live-ui-manual-verification.js <cdp-port> <command> [args...]",
    "",
    "Commands:",
    "  wait-app",
    "  title",
    "  status-text",
    "  open-settings",
    "  close-settings",
    "  send-prompt <text>",
    "  messages",
    "  text <selector-or-alias>",
    "  click <selector-or-alias>",
    "  fill <selector-or-alias> <value>",
    "  wait-for <selector-or-alias> [timeoutMs]",
    "  wait-for-text <selector-or-alias> <text> [timeoutMs]",
    "  is-disabled <selector-or-alias>",
    "  screenshot <path>",
    "  eval <javascript-expression>",
    "",
    "Aliases: app, status, settingsButton, newSessionButton, settingsModal, settingsClose, composerInput, composerSend, messages"
  ].join("\n");
}

function json(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [, , port, command, ...rest] = process.argv;
  if (!port || !command) {
    throw new Error(usage());
  }

  const { browser, page } = await connectToElectronApp(port);
  try {
    await waitForAppReady(page);

    switch (command) {
      case "wait-app":
        process.stdout.write("ready\n");
        return;
      case "title":
        process.stdout.write(`${await page.title()}\n`);
        return;
      case "status-text":
        process.stdout.write(`${(await resolveNamedLocator(page, "status").textContent())?.trim() ?? ""}\n`);
        return;
      case "open-settings":
        await resolveNamedLocator(page, "settingsButton").click();
        await resolveNamedLocator(page, "settingsModal").waitFor({ state: "visible", timeout: 5000 });
        process.stdout.write("opened\n");
        return;
      case "close-settings":
        await resolveNamedLocator(page, "settingsClose").click();
        await resolveNamedLocator(page, "settingsModal").waitFor({ state: "hidden", timeout: 5000 });
        process.stdout.write("closed\n");
        return;
      case "send-prompt": {
        const prompt = rest.join(" ");
        if (!prompt) {
          throw new Error("send-prompt requires text");
        }
        const input = resolveNamedLocator(page, "composerInput");
        await input.fill(prompt);
        await resolveNamedLocator(page, "composerSend").click();
        process.stdout.write("sent\n");
        return;
      }
      case "messages":
        json(await collectMessages(page));
        return;
      case "text": {
        const selector = rest[0];
        if (!selector) {
          throw new Error("text requires a selector-or-alias");
        }
        process.stdout.write(`${(await resolveNamedLocator(page, selector).textContent())?.trim() ?? ""}\n`);
        return;
      }
      case "click": {
        const selector = rest[0];
        if (!selector) {
          throw new Error("click requires a selector-or-alias");
        }
        await resolveNamedLocator(page, selector).click();
        process.stdout.write("clicked\n");
        return;
      }
      case "fill": {
        const selector = rest[0];
        const value = rest.slice(1).join(" ");
        if (!selector || !value) {
          throw new Error("fill requires a selector-or-alias and value");
        }
        const locator = resolveNamedLocator(page, selector);
        const tagName = await locator.evaluate((element) => element.tagName);
        if (tagName === "SELECT") {
          await locator.evaluate((element, nextValue) => {
            element.value = nextValue;
            element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          }, value);
        } else {
          await locator.fill(value);
        }
        process.stdout.write("filled\n");
        return;
      }
      case "wait-for": {
        const selector = rest[0];
        const timeoutMs = Number(rest[1] ?? 5000);
        if (!selector) {
          throw new Error("wait-for requires a selector-or-alias");
        }
        await resolveNamedLocator(page, selector).waitFor({ state: "visible", timeout: timeoutMs });
        process.stdout.write("visible\n");
        return;
      }
      case "wait-for-text": {
        const selector = rest[0];
        const expected = rest[1];
        const timeoutMs = Number(rest[2] ?? 15000);
        if (!selector || !expected) {
          throw new Error("wait-for-text requires a selector-or-alias and expected text");
        }
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const textContent = (await resolveNamedLocator(page, selector).textContent())?.trim() ?? "";
          if (textContent.includes(expected)) {
            process.stdout.write("matched\n");
            return;
          }
          await page.waitForTimeout(250);
        }
        throw new Error(`Timed out waiting for text "${expected}" in ${selector}`);
      }
      case "is-disabled": {
        const selector = rest[0];
        if (!selector) {
          throw new Error("is-disabled requires a selector-or-alias");
        }
        process.stdout.write(`${await resolveNamedLocator(page, selector).isDisabled()}\n`);
        return;
      }
      case "screenshot": {
        const targetPath = rest[0];
        if (!targetPath) {
          throw new Error("screenshot requires an output path");
        }
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        await page.screenshot({ path: targetPath, fullPage: true });
        process.stdout.write(`${targetPath}\n`);
        return;
      }
      case "eval": {
        const expression = rest.join(" ");
        if (!expression) {
          throw new Error("eval requires a javascript expression");
        }
        const value = await page.evaluate((code) => {
          return (0, eval)(code);
        }, expression);
        json(value);
        return;
      }
      default:
        throw new Error(usage());
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
