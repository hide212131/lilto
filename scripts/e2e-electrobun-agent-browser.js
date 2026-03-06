const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const driverPort = "39393";
const driverBaseUrl = `http://127.0.0.1:${driverPort}`;
const screenshotPath = path.join(rootDir, "test", "artifacts", "electrobun-e2e.png");
const settingsScreenshotPath = path.join(rootDir, "test", "artifacts", "electrobun-e2e-settings.png");

function resolveDesktopRuntimeBinary() {
  const binDir = path.join(rootDir, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? ["electrobun.cmd"]
      : ["electrobun"];

  for (const candidate of candidates) {
    const candidatePath = path.join(binDir, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`Electrobun binary not found. Checked: ${candidates.join(", ")}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDriverReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${driverBaseUrl}/health`);
      if (response.ok) return;
    } catch (_error) {
      // retry
    }
    await sleep(300);
  }
  throw new Error("Timed out waiting for Electrobun E2E driver");
}

async function evalJs(script) {
  const wrappedScript = `return (${script});`;
  const response = await fetch(`${driverBaseUrl}/eval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: wrappedScript })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`E2E eval failed: ${payload.error || response.statusText}`);
  }
  return payload.value;
}

function safeCaptureScreenshot(outputPath) {
  const captureResult = spawnSync("screencapture", ["-x", outputPath], {
    cwd: rootDir,
    stdio: "ignore"
  });

  if (captureResult.status === 0) {
    return;
  }

  const oneByOnePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgJf6sWQAAAAASUVORK5CYII=";
  fs.writeFileSync(outputPath, Buffer.from(oneByOnePng, "base64"));
}

function ensureCefProfileDirs() {
  const cefDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "sh.hide212131.lilto",
    "dev",
    "CEF"
  );
  fs.mkdirSync(path.join(cefDir, "Partitions", "default"), { recursive: true });
}

async function getStatusText() {
  return String(await evalJs(
    "(() => { const topBar = document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar'); const shadowText = topBar?.shadowRoot?.querySelector('.status')?.textContent?.trim(); const attrText = topBar?.getAttribute('statustext')?.trim(); return shadowText || attrText || ''; })()"
  ));
}

async function getCustomSaveStatusText() {
  return String(await evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-actions .status')?.textContent?.trim() ?? ''"
  ));
}

async function isSettingsModalOpen() {
  return Boolean(await evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.modal-backdrop')?.classList?.contains('open') ?? false"
  ));
}

async function getMessagesText() {
  return String(await evalJs(
    "Array.from(document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-message-list')?.shadowRoot?.querySelectorAll('.msg') ?? []).map(el => el.textContent?.trim()).join('\\n')"
  ));
}

async function clickSettingsButton() {
  await evalJs("document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar')?.shadowRoot?.querySelector('button[title=\\\"Settings\\\"]')?.click()\n");
}

async function clickNewSessionButton() {
  await evalJs("document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar')?.shadowRoot?.querySelector('button[title=\\\"New\\\"]')?.click()");
}

async function clickSettingsClose() {
  await evalJs("document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('button[title=\\\"Close\\\"]')?.click()");
}

async function switchToCustomProvider() {
  await evalJs("document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('input[value=\\\"custom-openai-completions\\\"]')?.click()");
}

async function setSettingsInputValue(id, value) {
  await evalJs(
    `(() => {
      const input = document.querySelector('lilt-app')
        ?.shadowRoot?.querySelector('lilt-settings-modal')
        ?.shadowRoot?.querySelector('#${id}');
      if (!input) return 'missing';
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      return 'ok';
    })()`
  );
}

async function setSettingsCheckboxValue(id, checked) {
  await evalJs(
    `(() => {
      const input = document.querySelector('lilt-app')
        ?.shadowRoot?.querySelector('lilt-settings-modal')
        ?.shadowRoot?.querySelector('#${id}');
      if (!input) return 'missing';
      input.checked = ${checked ? "true" : "false"};
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return 'ok';
    })()`
  );
}

async function clickSaveProviderSettingsButton() {
  await evalJs("document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-actions button')?.click()");
}

async function fillComposerText(value) {
  await evalJs(
    `(() => {
      const input = document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('textarea');
      if (!input) return;
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    })()`
  );
}

async function clickComposerSend() {
  await evalJs("document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('button')?.click()");
}

async function isSendDisabled() {
  return Boolean(await evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('button')?.disabled ?? true"
  ));
}

async function isNewSessionDisabled() {
  return Boolean(await evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar')?.shadowRoot?.querySelector('button[title=\\\"New\\\"]')?.disabled ?? true"
  ));
}

async function getMessageCount() {
  return Number(await evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-message-list')?.shadowRoot?.querySelectorAll('.msg')?.length ?? 0"
  ));
}

async function setAppSendingState(isSending) {
  await evalJs(
    `(() => {
      const app = document.querySelector('lilt-app');
      if (!app) return;
      app.isSending = ${isSending ? "true" : "false"};
      app.requestUpdate?.();
    })()`
  );
}

async function waitForStatus(expected, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getStatusText();
    if (expected.some((s) => text.includes(s))) return text;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for status. Expected one of: ${expected.join(", ")}.`);
}

async function waitForModalOpen(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isSettingsModalOpen()) return;
    await sleep(200);
  }
  throw new Error("Timed out waiting for settings modal to open");
}

async function waitForModalClose(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isSettingsModalOpen())) return;
    await sleep(200);
  }
  throw new Error("Timed out waiting for settings modal to close");
}

async function waitForSendEnabled(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isSendDisabled())) return;
    await sleep(300);
  }
  throw new Error("Timed out waiting for send button to be enabled");
}

async function waitForCustomSaveStatus(expectedText, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getCustomSaveStatusText();
    if (text.includes(expectedText)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for custom save status: ${expectedText}`);
}

async function waitForResponse(expectedText, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getMessagesText();
    if (messages.includes(expectedText)) return messages;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for response: ${expectedText}`);
}

async function waitForMessagesContaining(expectedTexts, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getMessagesText();
    if (expectedTexts.every((text) => messages.includes(text))) return messages;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for messages: ${expectedTexts.join(", ")}`);
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  ensureCefProfileDirs();
  const electrobunBin = resolveDesktopRuntimeBinary();

  const appProcess = spawn(electrobunBin, ["dev"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LILTO_E2E_DRIVER: "1",
      LILTO_E2E_DRIVER_PORT: driverPort,
      LILTO_E2E_MOCK: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let appLogs = "";
  appProcess.stdout.on("data", (chunk) => { appLogs += chunk.toString(); });
  appProcess.stderr.on("data", (chunk) => { appLogs += chunk.toString(); });

  try {
    console.log("Waiting for Electrobun E2E driver...");
    await waitForDriverReady();
    await waitForResponse("", 1).catch(() => undefined);

    const title = String(await evalJs("document.title || ''"));
    if (!title) {
      throw new Error(`Unexpected title: ${title}`);
    }
    console.log(`✓ Title: ${title}`);

    const appReady = await evalJs("!!document.querySelector('lilt-app')");
    if (!appReady) {
      throw new Error("lilt-app element not found in DOM");
    }
    console.log("✓ lilt-app rendered");

    const initialStatus = await waitForStatus(["待機中", "認証が必要", "Custom Provider"]);
    console.log(`✓ Initial status: ${initialStatus}`);

    await clickSettingsButton();
    await waitForModalOpen();
    safeCaptureScreenshot(settingsScreenshotPath);
    console.log(`✓ Settings screenshot: ${settingsScreenshotPath}`);

    await switchToCustomProvider();
    await setSettingsInputValue("custom-provider-name", "Proxy E2E Provider");
    await setSettingsInputValue("custom-base-url", "http://127.0.0.1:11434/v1");
    await setSettingsInputValue("custom-model-id", "qwen2.5:0.5b");
    await setSettingsCheckboxValue("use-proxy", true);
    await clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("Provider 設定を保存しました。");
    console.log("✓ Custom Provider saved");

    await clickSettingsClose();
    await waitForModalClose();
    await waitForSendEnabled();

    await setAppSendingState(true);
    await sleep(200);
    if (!(await isNewSessionDisabled())) {
      throw new Error("New session should be disabled while sending");
    }
    await setAppSendingState(false);
    await sleep(200);
    if (await isNewSessionDisabled()) {
      throw new Error("New session should be enabled after sending state is cleared");
    }
    console.log("✓ New session button state toggles");

    const message = "E2E mock response check";
    await fillComposerText(message);
    await clickComposerSend();

    const expectedFinal = `[E2E_MOCK_FINAL] 要求「${message}」を処理し、複数コマンドを実行して回答しました。`;
    await waitForResponse(expectedFinal);
    console.log("✓ Final response received");

    await waitForStatus(["待機中"]);

    const countBeforeReset = await getMessageCount();
    if (countBeforeReset < 2) {
      throw new Error(`Unexpected message count before reset: ${countBeforeReset}`);
    }
    await clickNewSessionButton();
    await sleep(300);
    const countAfterReset = await getMessageCount();
    if (countAfterReset !== 0) {
      throw new Error(`Expected cleared messages after new session, got: ${countAfterReset}`);
    }

    safeCaptureScreenshot(screenshotPath);
    console.log(`✓ Final screenshot: ${screenshotPath}`);
    console.log("\nE2E success!");
  } finally {
    try {
      await fetch(`${driverBaseUrl}/shutdown`, { method: "POST" });
    } catch (_error) {
      // ignore
    }

    appProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => appProcess.once("exit", resolve)),
      sleep(3000)
    ]);

    if (appLogs.trim()) {
      console.log("Electrobun logs:");
      console.log(appLogs);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
