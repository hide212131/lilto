const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createProxyFixture } = require("./e2e-proxy-fixture");

const rootDir = path.resolve(__dirname, "..");
const sessionName = "lilto-electron-e2e";
const cdpPort = "9222";
const screenshotPath = path.join(rootDir, "test", "artifacts", "electron-e2e.png");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    encoding: "utf8",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${cmd} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  return result.stdout.trim();
}

async function waitForCdpReady(timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${cdpPort}/json/version`;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_error) {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

function agentBrowser(args) {
  const shell = process.platform === "win32" ? "npx.cmd" : "npx";
  return run(shell, ["agent-browser", "--session", sessionName, ...args]);
}

function evalJs(js) {
  return agentBrowser(["eval", js]);
}

function getStatusText() {
  return evalJs(
    "(() => { const topBar = document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar'); const shadowText = topBar?.shadowRoot?.querySelector('.status')?.textContent?.trim(); const attrText = topBar?.getAttribute('statustext')?.trim(); return shadowText || attrText || ''; })()"
  );
}

function getAuthStatusText() {
  return evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-section .auth-row .status')?.textContent?.trim() ?? ''"
  );
}

function getCustomSaveStatusText() {
  return evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-actions .status')?.textContent?.trim() ?? ''"
  );
}

function isSettingsModalOpen() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.modal-backdrop')?.classList?.contains('open') ?? false"
  );
  return result === "true";
}

function getMessagesText() {
  return evalJs(
    "Array.from(document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-message-list')?.shadowRoot?.querySelectorAll('.msg') ?? []).map(el => el.textContent?.trim()).join('\\n')"
  );
}

function clickSettingsButton() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar')?.shadowRoot?.querySelector('button[title=\"Settings\"]')?.click()"
  );
}

function clickNewSessionButton() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar')?.shadowRoot?.querySelector('button[title=\"New\"]')?.click()"
  );
}

function clickSettingsClose() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('button[title=\"Close\"]')?.click()"
  );
}

function switchToClaudeProvider() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('input[value=\"claude\"]')?.click()"
  );
}

function switchToCustomProvider() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('input[value=\"custom-openai-completions\"]')?.click()"
  );
}

function clickClaudeOauthButton() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-section .auth-row button')?.click()"
  );
}

function setSettingsInputValue(id, value) {
  evalJs(
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

function clickSaveProviderSettingsButton() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-actions button')?.click()"
  );
}

function fillComposerText(value) {
  evalJs(
    `(() => {
      const input = document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('textarea');
      if (!input) return;
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    })()`
  );
}

function clickComposerSend() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('button')?.click()"
  );
}

function isSendDisabled() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('button')?.disabled ?? true"
  );
  return result === "true";
}

function isNewSessionDisabled() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar')?.shadowRoot?.querySelector('button[title=\"New\"]')?.disabled ?? true"
  );
  return result === "true";
}

function getMessageCount() {
  const result = evalJs(
    "String(document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-message-list')?.shadowRoot?.querySelectorAll('.msg')?.length ?? 0)"
  );
  const normalized = String(result).replaceAll("\"", "").trim();
  return Number.parseInt(normalized, 10);
}

function setAppSendingState(isSending) {
  evalJs(
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
    const text = getStatusText();
    if (expected.some((s) => text.includes(s))) return text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for status. Expected one of: ${expected.join(", ")}. Last: "${getStatusText()}"`);
}

async function waitForModalOpen(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isSettingsModalOpen()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for settings modal to open");
}

async function waitForModalClose(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isSettingsModalOpen()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for settings modal to close");
}

async function waitForSendEnabled(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isSendDisabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for send button to be enabled");
}

async function waitForCustomSaveStatus(expectedText, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = getCustomSaveStatusText();
    if (text.includes(expectedText)) return text;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for custom save status: "${expectedText}". Last: "${getCustomSaveStatusText()}"`);
}

async function waitForResponse(expectedText, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msgs = getMessagesText();
    if (msgs.includes(expectedText)) return msgs;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for response. Expected: "${expectedText}". Messages: "${getMessagesText()}"`);
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const proxyFixture = await createProxyFixture();

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", ".bin", "electron.cmd")
      : path.join(rootDir, "node_modules", ".bin", "electron");

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    env: {
      ...process.env,
      LILTO_E2E_MOCK: "1",
      LILTO_PROXY_TEST_URL: proxyFixture.targetUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let electronLogs = "";
  electron.stdout.on("data", (chunk) => { electronLogs += chunk.toString(); });
  electron.stderr.on("data", (chunk) => { electronLogs += chunk.toString(); });

  try {
    console.log("Waiting for CDP...");
    await waitForCdpReady();
    agentBrowser(["connect", cdpPort]);
    console.log("Connected to CDP");

    // 1. タイトル確認
    const title = agentBrowser(["get", "title"]);
    if (!title.includes("Lilt-o")) throw new Error(`Unexpected title: ${title}`);
    console.log(`✓ Title: "${title}"`);

    // 2. lilt-app レンダリング確認
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const appExists = evalJs("!!document.querySelector('lilt-app')");
    if (appExists !== "true") throw new Error("lilt-app element not found in DOM");
    console.log("✓ lilt-app rendered");

    // 3. 初期ステータス確認
    const initialStatus = await waitForStatus([
      "待機中",
      "認証が必要",
      "Claude 認証が必要",
      "Custom Provider"
    ]);
    console.log(`✓ Initial status: "${initialStatus}"`);

    // 4. 設定モーダルを開く
    console.log("Opening settings modal...");
    clickSettingsButton();
    await waitForModalOpen();
    console.log("✓ Settings modal opened");

    // 5. 設定画面スクリーンショット
    const ssSettings = path.join(rootDir, "test", "artifacts", "electron-e2e-settings.png");
    agentBrowser(["screenshot", ssSettings]);
    console.log(`✓ Settings screenshot: ${ssSettings}`);

    // 6. E2E 用に Custom Provider を保存（Proxy は未設定）
    switchToCustomProvider();
    setSettingsInputValue("custom-provider-name", "Proxy E2E Provider");
    setSettingsInputValue("custom-base-url", "http://127.0.0.1:11434/v1");
    setSettingsInputValue("custom-model-id", "qwen2.5:0.5b");
    setSettingsInputValue("http-proxy", "");
    setSettingsInputValue("https-proxy", "");
    setSettingsInputValue("no-proxy", "");
    clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("Provider 設定を保存しました。");
    setSettingsInputValue("http-proxy", "invalid-proxy-url");
    clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("INVALID_PROVIDER_SETTINGS");
    setSettingsInputValue("http-proxy", "");
    clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("Provider 設定を保存しました。");
    console.log("✓ Custom Provider saved without proxy");

    // 7. 設定モーダルを閉じる
    clickSettingsClose();
    await waitForModalClose();
    console.log("✓ Settings modal closed");

    // 8. 送信ボタン有効化待ち
    await waitForSendEnabled();
    const statusAfterSwitch = getStatusText();
    console.log(`✓ Status after provider switch: "${statusAfterSwitch}"`);

    // 9. isSending 連動で New ボタンが無効化されることを確認
    setAppSendingState(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!isNewSessionDisabled()) throw new Error("New session button should be disabled when app isSending=true");
    setAppSendingState(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (isNewSessionDisabled()) throw new Error("New session button should be enabled when app isSending=false");
    console.log("✓ New session button enable/disable state toggles with isSending");

    // 10. Proxy 未設定で送信し、失敗を確認
    const firstMessage = "E2E proxy check without proxy";
    console.log(`Sending without proxy: "${firstMessage}"...`);
    fillComposerText(firstMessage);
    clickComposerSend();
    await waitForResponse("PROXY_CONNECTION_FAILED");
    console.log("✓ Proxy missing failure detected");

    // 11. Settings で Proxy を設定して保存
    clickSettingsButton();
    await waitForModalOpen();
    switchToCustomProvider();
    setSettingsInputValue("http-proxy", proxyFixture.proxyUrl);
    setSettingsInputValue("https-proxy", proxyFixture.proxyUrl);
    setSettingsInputValue("no-proxy", "");
    clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("Provider 設定を保存しました。");
    clickSettingsClose();
    await waitForModalClose();
    await waitForSendEnabled();
    console.log("✓ Proxy settings saved");

    // 12. Proxy 設定ありで送信し、成功を確認
    const secondMessage = "E2E proxy check with proxy";
    console.log(`Sending with proxy: "${secondMessage}"...`);
    fillComposerText(secondMessage);
    clickComposerSend();

    const expectedMock = `[E2E_MOCK] ${secondMessage}`;
    await waitForResponse(expectedMock);
    console.log(`✓ Mock response received: "${expectedMock}"`);

    // 13. 最終ステータス確認
    const finalStatus = await waitForStatus(["待機中"]);
    console.log(`✓ Final status: "${finalStatus}"`);

    // 14. 新規セッション開始で会話履歴を初期化
    const countBeforeReset = getMessageCount();
    if (countBeforeReset < 4) throw new Error(`Unexpected message count before reset: ${countBeforeReset}`);
    clickNewSessionButton();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const countAfterReset = getMessageCount();
    if (countAfterReset !== 0) throw new Error(`Expected cleared messages after new session, got: ${countAfterReset}`);
    if (isNewSessionDisabled()) throw new Error("New session button should be enabled after sending");
    console.log("✓ New session reset cleared conversation");

    // 15. 最終スクリーンショット
    agentBrowser(["screenshot", screenshotPath]);
    console.log(`✓ Final screenshot: ${screenshotPath}`);

    const messages = getMessagesText();
    console.log("\nE2E success!");
    console.log("Conversation:");
    messages.split("\n").forEach((m) => { if (m) console.log(`  - ${m}`); });
  } finally {
    try { agentBrowser(["close"]); } catch (_error) { /* ignore */ }
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
