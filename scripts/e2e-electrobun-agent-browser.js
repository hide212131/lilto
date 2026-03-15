const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProxyFixture } = require("./e2e-proxy-fixture");
const { normalizeCommandArgs, normalizeWorkingDirectory, resolveCliCommand } = require("./command-compat");

const rootDir = path.resolve(__dirname, "..");
const driverPort = "39393";
const driverBaseUrl = `http://127.0.0.1:${driverPort}`;
const cdpPort = process.env.LILTO_E2E_CDP_PORT || "9224";
const screenshotPath = path.join(rootDir, "test", "artifacts", "electrobun-e2e.png");
const settingsScreenshotPath = path.join(rootDir, "test", "artifacts", "electrobun-e2e-settings.png");
const providerSettingsPath = path.join(rootDir, ".lilto-provider-settings.json");
const providerSettingsBackupPath = path.join(rootDir, "test", "artifacts", "e2e-mock-provider-settings.json");
const buildDir = path.join(rootDir, "build", "dev-win-x64");

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

function resolveBuiltLauncherPath() {
  if (process.platform === "darwin") {
    return path.join(rootDir, "build", "dev-macos-arm64", "lilt-o-dev.app", "Contents", "MacOS", "launcher");
  }
  if (process.platform === "linux") {
    return path.join(rootDir, "build", "dev-linux-x64", "lilt-o-dev", "bin", "launcher");
  }
  if (process.platform === "win32") {
    return path.join(rootDir, "build", "dev-win-x64", "lilt-o-dev", "bin", "launcher.exe");
  }
  throw new Error(`Unsupported platform for Electrobun E2E: ${process.platform}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(cmd, args, options = {}) {
  const resolvedCmd = resolveCliCommand(cmd);
  const resolvedArgs = normalizeCommandArgs(args);
  const isWindowsBatchCommand =
    process.platform === "win32" &&
    (resolvedCmd.toLowerCase().endsWith(".cmd") || resolvedCmd.toLowerCase().endsWith(".bat"));

  if (isWindowsBatchCommand) {
    const batchResult = spawnSync(resolvedCmd, resolvedArgs, {
      cwd: normalizeWorkingDirectory(rootDir),
      encoding: "utf8",
      shell: true,
      ...options
    });

    if (batchResult.status !== 0) {
      throw new Error(
        [
          `Command failed: ${cmd} ${args.join(" ")}`,
          batchResult.stdout ? `stdout:\n${batchResult.stdout}` : "",
          batchResult.stderr ? `stderr:\n${batchResult.stderr}` : "",
          batchResult.error ? `error:\n${batchResult.error.message}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    return batchResult.stdout.trim();
  }

  const result = spawnSync(resolvedCmd, resolvedArgs, {
    cwd: normalizeWorkingDirectory(rootDir),
    encoding: "utf8",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${cmd} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        result.error ? `error:\n${result.error.message}` : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  return result.stdout.trim();
}

function runDesktopRuntime(args, options = {}) {
  return run(resolveDesktopRuntimeBinary(), args, options);
}

function getE2eCefProfileDir() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "sh.hide212131.lilto", "dev", "CEF");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "sh.hide212131.lilto", "dev", "CEF");
  }
  return path.join(os.homedir(), ".config", "sh.hide212131.lilto", "dev", "CEF");
}

function ensureCleanDirectory(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function cleanupWindowsBuildProcesses() {
  if (process.platform !== "win32") {
    return;
  }

  const normalizedBuildDir = `${path.win32.normalize(buildDir)}\\`;
  const cleanupScript = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$buildDir = [System.IO.Path]::GetFullPath($args[0])",
    "$normalized = $buildDir.TrimEnd('\\') + '\\'",
    "$processes = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ExecutablePath -and $_.ExecutablePath.StartsWith($normalized, [System.StringComparison]::OrdinalIgnoreCase)",
    "}",
    "foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }"
  ].join("; ");

  spawnSync("powershell", ["-NoProfile", "-Command", cleanupScript, normalizedBuildDir], {
    cwd: normalizeWorkingDirectory(rootDir),
    stdio: "ignore"
  });
}

async function waitForDriverReady(appProcess, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electrobun app exited before E2E driver was ready (exit code: ${appProcess.exitCode})`);
    }
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

async function waitForCdpReady(appProcess, timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${cdpPort}/json/version`;
  while (Date.now() - start < timeoutMs) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electrobun app exited before CDP was ready (exit code: ${appProcess.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        const versionPayload = await response.json();
        if (versionPayload.webSocketDebuggerUrl) {
          return;
        }
      }
    } catch (_error) {
      // retry
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

function cdpCommand(args) {
  return run(process.execPath, [path.join(__dirname, "e2e-cdp-command.js"), cdpPort, ...args]);
}

async function evalJs(script) {
  const output = cdpCommand(["eval", script]);
  if (output === "true") return true;
  if (output === "false") return false;
  if (output === "null") return null;
  if (output === "") return "";
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function ensureCefProfileDirs() {
  const cefDir = getE2eCefProfileDir();
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

function removeFileIfExists(targetPath) {
  try {
    fs.unlinkSync(targetPath);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function backupProviderSettings() {
  removeFileIfExists(providerSettingsBackupPath);
  if (!fs.existsSync(providerSettingsPath)) {
    return false;
  }
  fs.copyFileSync(providerSettingsPath, providerSettingsBackupPath);
  fs.unlinkSync(providerSettingsPath);
  return true;
}

function restoreProviderSettings(hadOriginalSettings) {
  if (hadOriginalSettings && fs.existsSync(providerSettingsBackupPath)) {
    fs.copyFileSync(providerSettingsBackupPath, providerSettingsPath);
  } else {
    removeFileIfExists(providerSettingsPath);
  }
  removeFileIfExists(providerSettingsBackupPath);
}

async function configureProxyFixture(targetUrl, proxyUrl, noProxy = "") {
  const response = await fetch(`${driverBaseUrl}/configure-proxy-fixture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetUrl, proxyUrl, noProxy })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Failed to configure proxy fixture: ${payload.error || response.statusText}`);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  cleanupWindowsBuildProcesses();
  ensureCleanDirectory(getE2eCefProfileDir());
  ensureCefProfileDirs();
  const hadOriginalProviderSettings = backupProviderSettings();
  const proxyFixture = await createProxyFixture();
  try {
    runDesktopRuntime(["build"], {
      env: {
        ...process.env,
        LILTO_E2E_USE_CEF: "1",
        LILTO_E2E_CDP_PORT: cdpPort
      }
    });
  } catch (error) {
    throw new Error(`Electrobun build failed before E2E run.\n${error.message}`);
  }

  const launcherPath = resolveBuiltLauncherPath();
  if (!fs.existsSync(launcherPath)) {
    throw new Error(`Electrobun launcher not found after build: ${launcherPath}`);
  }

  const appProcess = spawn(launcherPath, [], {
    cwd: path.dirname(launcherPath),
    env: {
      ...process.env,
      LILTO_E2E_DRIVER: "1",
      LILTO_E2E_DRIVER_PORT: driverPort,
      LILTO_E2E_MOCK: "1",
      LILTO_E2E_USE_CEF: "1",
      LILTO_E2E_CDP_PORT: cdpPort
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let appLogs = "";
  appProcess.stdout.on("data", (chunk) => { appLogs += chunk.toString(); });
  appProcess.stderr.on("data", (chunk) => { appLogs += chunk.toString(); });

  try {
    console.log("Waiting for Electrobun E2E driver...");
    await waitForDriverReady(appProcess);
    console.log("Waiting for CDP...");
    await waitForCdpReady(appProcess);
    await configureProxyFixture(proxyFixture.targetUrl, proxyFixture.proxyUrl);
    await waitForResponse("", 1).catch(() => undefined);

    const title = String(cdpCommand(["get", "title"]));
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
    cdpCommand(["screenshot", settingsScreenshotPath]);
    console.log(`✓ Settings screenshot: ${settingsScreenshotPath}`);

    await switchToCustomProvider();
    await setSettingsInputValue("custom-provider-name", "Proxy E2E Provider");
    await setSettingsInputValue("custom-base-url", "http://127.0.0.1:11434/v1");
    await setSettingsInputValue("custom-model-id", "qwen2.5:0.5b");
    await setSettingsInputValue("custom-api-key", "e2e-dummy-key");
    await setSettingsCheckboxValue("use-proxy", false);
    await clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("Provider 設定を保存しました。");
    console.log("✓ Custom Provider saved with proxy disabled");

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

    const firstMessage = "E2E proxy check without proxy";
    await fillComposerText(firstMessage);
    await clickComposerSend();
    await waitForResponse("PROXY_CONNECTION_FAILED");
    console.log("✓ Proxy missing failure detected");

    await clickSettingsButton();
    await waitForModalOpen();
    await switchToCustomProvider();
    await setSettingsCheckboxValue("use-proxy", true);
    await clickSaveProviderSettingsButton();
    await waitForCustomSaveStatus("Provider 設定を保存しました。");
    await clickSettingsClose();
    await waitForModalClose();
    await waitForSendEnabled();
    console.log("✓ Proxy usage enabled");

    const secondMessage = "E2E proxy check with proxy";
    await fillComposerText(secondMessage);
    await clickComposerSend();

    const expectedFinal = `[E2E_MOCK_FINAL] 要求「${secondMessage}」を処理し、複数コマンドを実行して回答しました。`;
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

    cdpCommand(["screenshot", screenshotPath]);
    console.log(`✓ Final screenshot: ${screenshotPath}`);
    console.log("\nE2E success!");
  } finally {
    try {
      await fetch(`${driverBaseUrl}/shutdown`, { method: "POST" });
    } catch (_error) {
      // ignore
    }

    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(appProcess.pid), "/T", "/F"], {
        cwd: normalizeWorkingDirectory(rootDir),
        stdio: "ignore"
      });
    } else {
      appProcess.kill("SIGTERM");
    }
    await Promise.race([
      new Promise((resolve) => appProcess.once("exit", resolve)),
      sleep(3000)
    ]);

    if (appLogs.trim()) {
      console.log("Electrobun logs:");
      console.log(appLogs);
    }
    await proxyFixture.close();
    restoreProviderSettings(hadOriginalProviderSettings);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
