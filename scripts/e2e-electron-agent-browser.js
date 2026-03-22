const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { createProxyFixture } = require("./e2e-proxy-fixture");
const {
  collectMessages,
  connectToElectronApp,
  resolveNamedLocator,
  waitForAppReady
} = require("./electron-playwright");

const rootDir = path.resolve(__dirname, "..");
let cdpPort = "9222";
const screenshotPath = path.join(rootDir, "test", "artifacts", "electron-e2e.png");
const mockProviderSettingsPath = path.join(rootDir, "test", "artifacts", "e2e-mock-provider-settings.json");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? String(address.port) : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error("Failed to resolve a free TCP port"));
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function shouldUseShellForCommand(commandPath) {
  if (process.platform !== "win32") return false;
  const lower = String(commandPath || "").toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

async function waitForCdpReady(timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${cdpPort}/json/version`;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

async function getStatusText(page) {
  return ((await resolveNamedLocator(page, "status").textContent()) ?? "").trim();
}

async function getCustomSaveStatusText(page) {
  const statuses = resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator(".provider-actions .status");
  const count = await statuses.count();
  if (count === 0) {
    return "";
  }
  return ((await statuses.nth(count - 1).textContent()) ?? "").trim();
}

async function getMessagesText(page) {
  return (await collectMessages(page))
    .map((message) => message.trim())
    .filter(Boolean)
    .join("\n");
}

async function injectSchedulerNotification(page, messageText, followUpInstruction) {
  await page.evaluate(
    ({ message, followUp }) => {
      const app = document.querySelector("lilt-app");
      if (!app || !app.activeSessionId) return "missing-session";
      app._bindBackendSession?.(app.activeSessionId, "agent-session-e2e");
      app._onSchedulerNotification?.({
        id: "schedule-e2e-1",
        sessionId: "agent-session-e2e",
        message,
        followUpInstruction: followUp,
        firedAt: new Date().toISOString()
      });
      return "ok";
    },
    { message: messageText, followUp: followUpInstruction ?? null }
  );
}

async function clickSettingsButton(page) {
  await resolveNamedLocator(page, "settingsButton").click();
}

async function clickNewSessionButton(page) {
  await resolveNamedLocator(page, "newSessionButton").click();
}

async function clickSettingsClose(page) {
  await resolveNamedLocator(page, "settingsClose").click();
}

async function switchToCustomProvider(page) {
  await resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator('input[value="custom-openai-completions"]')
    .check();
}

async function setSettingsInputValue(page, id, value) {
  const field = resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator(`#${id}`);
  const tagName = await field.evaluate((element) => element.tagName);
  if (tagName === "SELECT") {
    await field.evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }, value);
    return;
  }
  await field.fill(value);
}

async function setSettingsCheckboxValue(page, id, checked) {
  await resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator(`#${id}`)
    .setChecked(checked);
}

async function clickSaveProviderSettingsButton(page) {
  await resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .getByRole("button", { name: "Save Settings" })
    .click();
}

async function fillComposerText(page, value) {
  await resolveNamedLocator(page, "composerInput").fill(value);
}

async function clickComposerSend(page) {
  await resolveNamedLocator(page, "composerSend").click();
}

async function holdComposerDictation(page) {
  await resolveNamedLocator(page, "composerDictation").dispatchEvent("pointerdown", {
    bubbles: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0
  });
}

async function releaseComposerDictation(page) {
  await resolveNamedLocator(page, "composerDictation").dispatchEvent("pointerup", {
    bubbles: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0
  });
}

async function isSendDisabled(page) {
  return await resolveNamedLocator(page, "composerSend").isDisabled();
}

async function isNewSessionDisabled(page) {
  return await resolveNamedLocator(page, "newSessionButton").isDisabled();
}

async function getMessageCount(page) {
  return await resolveNamedLocator(page, "messages").count();
}

async function getDictationStatusText(page) {
  return ((await resolveNamedLocator(page, "composerDictationStatus").textContent()) ?? "").trim();
}

async function setAppSendingState(page, isSending) {
  await page.evaluate((sending) => {
    const app = document.querySelector("lilt-app");
    if (!app) return;
    app.isSending = sending;
    app.requestUpdate?.();
  }, isSending);
}

async function waitForStatus(page, expected, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getStatusText(page);
    if (expected.some((status) => text.includes(status))) return text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for status. Expected one of: ${expected.join(", ")}. Last: "${await getStatusText(page)}"`
  );
}

async function waitForModalOpen(page, timeoutMs = 5000) {
  await resolveNamedLocator(page, "settingsModal").waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForModalClose(page, timeoutMs = 5000) {
  await resolveNamedLocator(page, "settingsModal").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function waitForSendEnabled(page, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isSendDisabled(page))) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for send button to be enabled");
}

async function waitForCustomSaveStatus(page, expectedText, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getCustomSaveStatusText(page);
    if (text.includes(expectedText)) return text;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for custom save status: "${expectedText}". Last: "${await getCustomSaveStatusText(page)}"`
  );
}

async function waitForResponse(page, expectedText, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getMessagesText(page);
    if (messages.includes(expectedText)) return messages;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for response. Expected: "${expectedText}". Messages: "${await getMessagesText(page)}"`
  );
}

async function waitForDictationStatus(page, expectedText, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getDictationStatusText(page);
    if (text.includes(expectedText)) return text;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Timed out waiting for dictation status "${expectedText}". Last: "${await getDictationStatusText(page)}"`
  );
}

async function waitForDictationStatusClear(page, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getDictationStatusText(page);
    if (!text) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for dictation status clear. Last: "${await getDictationStatusText(page)}"`);
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  try {
    fs.unlinkSync(mockProviderSettingsPath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  cdpPort = await getFreePort();
  const proxyFixture = await createProxyFixture();

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", "electron", "dist", "electron.exe")
      : process.platform === "darwin"
        ? path.join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
        : path.join(rootDir, "node_modules", "electron", "dist", "electron");
  const electronEnv = {
    ...process.env,
    LILTO_E2E_MOCK: "1",
    LILTO_PROVIDER_SETTINGS_PATH: mockProviderSettingsPath,
    LILTO_PROXY_TEST_URL: proxyFixture.targetUrl,
    HTTP_PROXY: proxyFixture.proxyUrl,
    HTTPS_PROXY: proxyFixture.proxyUrl,
    NO_PROXY: ""
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    shell: shouldUseShellForCommand(electronBin),
    env: electronEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let electronLogs = "";
  electron.stdout.on("data", (chunk) => {
    electronLogs += chunk.toString();
  });
  electron.stderr.on("data", (chunk) => {
    electronLogs += chunk.toString();
  });

  let browser;
  let page;
  try {
    console.log("Waiting for CDP...");
    await waitForCdpReady();
    console.log("CDP endpoint ready");

    ({ browser, page } = await connectToElectronApp(cdpPort));
    await waitForAppReady(page);

    const title = await page.title();
    if (!title.includes("Lilt-o")) throw new Error(`Unexpected title: ${title}`);
    console.log(`✓ Title: "${title}"`);

    console.log("✓ lilt-app rendered");

    const initialStatus = await waitForStatus(page, [
      "待機中",
      "認証が必要",
      "Claude 認証が必要",
      "Custom Provider",
      "プロバイダー設定が必要"
    ]);
    console.log(`✓ Initial status: "${initialStatus}"`);

    console.log("Opening settings modal...");
    await clickSettingsButton(page);
    await waitForModalOpen(page);
    console.log("✓ Settings modal opened");

    const ssSettings = path.join(rootDir, "test", "artifacts", "electron-e2e-settings.png");
    await page.screenshot({ path: ssSettings, fullPage: true });
    console.log(`✓ Settings screenshot: ${ssSettings}`);

    await switchToCustomProvider(page);
    await setSettingsInputValue(page, "custom-provider-name", "Proxy E2E Provider");
    await setSettingsInputValue(page, "custom-base-url", "http://127.0.0.1:11434/v1");
    await setSettingsInputValue(page, "custom-api-key", "e2e-dummy-key");
    await setSettingsInputValue(page, "custom-model-id", "qwen2.5:0.5b");
    await setSettingsCheckboxValue(page, "use-proxy", false);
    await clickSaveProviderSettingsButton(page);
    await waitForCustomSaveStatus(page, "設定を保存しました。");
    console.log("✓ Custom Provider saved with proxy usage disabled");

    await clickSettingsClose(page);
    await waitForModalClose(page);
    console.log("✓ Settings modal closed");

    await waitForSendEnabled(page);
    const statusAfterSwitch = await getStatusText(page);
    console.log(`✓ Status after provider switch: "${statusAfterSwitch}"`);

    await setAppSendingState(page, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!(await isNewSessionDisabled(page))) {
      throw new Error("New session button should be disabled when app isSending=true");
    }
    await setAppSendingState(page, false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await isNewSessionDisabled(page)) {
      throw new Error("New session button should be enabled when app isSending=false");
    }
    console.log("✓ New session button enable/disable state toggles with isSending");

    await holdComposerDictation(page);
    await waitForDictationStatus(page, "音声入力中...");
    await releaseComposerDictation(page);
    await waitForDictationStatusClear(page);
    console.log("✓ Dictation button toggles active status only while pressed");

    const firstMessage = "E2E proxy check without proxy";
    console.log(`Sending without proxy: "${firstMessage}"...`);
    await fillComposerText(page, firstMessage);
    await clickComposerSend(page);
    await waitForResponse(page, "PROXY_CONNECTION_FAILED");
    console.log("✓ Proxy missing failure detected");

    await clickSettingsButton(page);
    await waitForModalOpen(page);
    await switchToCustomProvider(page);
    await setSettingsCheckboxValue(page, "use-proxy", true);
    await clickSaveProviderSettingsButton(page);
    await waitForCustomSaveStatus(page, "設定を保存しました。");
    await clickSettingsClose(page);
    await waitForModalClose(page);
    await waitForSendEnabled(page);
    console.log("✓ Proxy usage enabled");

    const secondMessage = "E2E proxy check with proxy";
    console.log(`Sending with proxy: "${secondMessage}"...`);
    await fillComposerText(page, secondMessage);
    await clickComposerSend(page);

    const expectedFinal = `[E2E_MOCK_FINAL] 要求「${secondMessage}」を処理し、複数コマンドを実行して回答しました。`;
    await waitForResponse(page, expectedFinal);
    console.log(`✓ Mock final response received: "${expectedFinal}"`);

    const schedulerMessage = "3分たちました。";
    const schedulerFollowUp = "alpha.co.jp を開きます";
    await injectSchedulerNotification(page, schedulerMessage, schedulerFollowUp);
    await waitForResponse(page, schedulerMessage);
    await waitForResponse(page, `続きの処理: ${schedulerFollowUp}`);
    const schedulerFinal = "[E2E_MOCK_FINAL] 要求「以下はこの会話で発火した scheduler 通知です。";
    await waitForResponse(page, schedulerFinal);
    console.log(`✓ Scheduler notification + follow-up rendered: "${schedulerMessage}" / "${schedulerFollowUp}"`);

    const finalStatus = await waitForStatus(page, ["待機中"]);
    console.log(`✓ Final status: "${finalStatus}"`);

    const countBeforeReset = await getMessageCount(page);
    if (countBeforeReset < 4) throw new Error(`Unexpected message count before reset: ${countBeforeReset}`);
    await clickNewSessionButton(page);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const countAfterReset = await getMessageCount(page);
    if (countAfterReset !== 0) throw new Error(`Expected cleared messages after new session, got: ${countAfterReset}`);
    if (await isNewSessionDisabled(page)) throw new Error("New session button should be enabled after sending");
    console.log("✓ New session reset cleared conversation");

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✓ Final screenshot: ${screenshotPath}`);

    const messages = await getMessagesText(page);
    console.log("\nE2E success!");
    console.log("Conversation:");
    messages.split("\n").forEach((message) => {
      if (message) console.log(`  - ${message}`);
    });
  } finally {
    await browser?.close().catch(() => {});

    electron.kill("SIGTERM");
    await new Promise((resolve) => {
      electron.once("exit", () => resolve());
      setTimeout(() => resolve(), 3000);
    });
    if (electronLogs.trim()) {
      console.log("Electron logs:");
      console.log(electronLogs);
    }
    await proxyFixture.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
