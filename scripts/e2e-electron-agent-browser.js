const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

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

function clickClaudeOauthButton() {
  evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.provider-section .auth-row button')?.click()"
  );
}

function setCustomProviderStateOnApp() {
  evalJs(
    `(() => {
      const app = document.querySelector('lilt-app');
      if (!app) return 'no-app';
      const current = app.providerSettings ?? {};
      const nextCustom = current.customProvider ?? {};
      app.providerSettings = {
        ...current,
        activeProvider: 'custom-openai-completions',
        customProvider: {
          ...nextCustom,
          name: nextCustom.name || 'Ollama E2E',
          baseUrl: nextCustom.baseUrl || 'http://127.0.0.1:11434/v1'
        }
      };
      app.requestUpdate?.();
      return 'ok';
    })()`
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

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", ".bin", "electron.cmd")
      : path.join(rootDir, "node_modules", ".bin", "electron");

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    env: { ...process.env, LILTO_E2E_MOCK: "1" },
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

    // 6. E2E 用に Custom Provider 状態を適用
    setCustomProviderStateOnApp();
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log("✓ Custom Provider state applied");

    // 7. 設定モーダルを閉じる
    clickSettingsClose();
    await waitForModalClose();
    console.log("✓ Settings modal closed");

    // 8. 送信ボタン有効化待ち
    await waitForSendEnabled();
    const statusAfterSwitch = getStatusText();
    console.log(`✓ Status after provider switch: "${statusAfterSwitch}"`);

    // 9. メッセージ送信
    const testMessage = "E2E smoke from agent-browser";
    console.log(`Sending: "${testMessage}"...`);
    fillComposerText(testMessage);
    clickComposerSend();

    // 10. モック応答確認
    const expectedMock = `[E2E_MOCK] ${testMessage}`;
    await waitForResponse(expectedMock);
    console.log(`✓ Mock response received: "${expectedMock}"`);

    // 11. 最終ステータス確認
    const finalStatus = await waitForStatus(["待機中"]);
    console.log(`✓ Final status: "${finalStatus}"`);

    // 12. 最終スクリーンショット
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
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
