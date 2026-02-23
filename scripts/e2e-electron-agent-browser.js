const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sessionName = "lilt-electron-e2e";
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
      // CDP endpoint is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

function agentBrowser(args) {
  const shell = process.platform === "win32" ? "npx.cmd" : "npx";
  return run(shell, ["agent-browser", "--session", sessionName, ...args]);
}

async function waitForStatus(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statusText = agentBrowser(["get", "text", "#status"]);
    if (statusText.includes("待機中") || statusText.includes("エラー")) {
      return statusText;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for status transition");
}

async function waitForAuthReady(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const authStatus = agentBrowser(["get", "text", "#auth-status"]);
    if (authStatus.includes("認証完了") || authStatus.includes("認証済み")) {
      return authStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for auth ready");
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", ".bin", "electron.cmd")
      : path.join(rootDir, "node_modules", ".bin", "electron");

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    env: {
      ...process.env,
      LILT_E2E_MOCK: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let electronLogs = "";
  electron.stdout.on("data", (chunk) => {
    electronLogs += chunk.toString();
  });
  electron.stderr.on("data", (chunk) => {
    electronLogs += chunk.toString();
  });

  try {
    await waitForCdpReady();

    agentBrowser(["connect", cdpPort]);
    const title = agentBrowser(["get", "title"]);
    if (!title.includes("Lilt-AI")) {
      throw new Error(`Unexpected title: ${title}`);
    }

    const initialStatus = agentBrowser(["get", "text", "#status"]);
    if (!initialStatus.includes("待機中") && !initialStatus.includes("認証が必要")) {
      throw new Error(`Unexpected initial status: ${initialStatus}`);
    }

    await waitForAuthReady();
    agentBrowser(["fill", "#prompt", "E2E smoke from agent-browser"]);
    agentBrowser(["click", "#send"]);
    const finalStatus = await waitForStatus();
    if (!finalStatus.includes("待機中")) {
      throw new Error(`Unexpected final status: ${finalStatus}`);
    }

    const conversation = agentBrowser(["get", "text", "#messages"]);
    if (!conversation.includes("[E2E_MOCK] E2E smoke from agent-browser")) {
      throw new Error(`Unexpected conversation: ${conversation}`);
    }

    agentBrowser(["screenshot", screenshotPath]);
    console.log(`E2E success. Screenshot: ${screenshotPath}`);
  } finally {
    try {
      agentBrowser(["close"]);
    } catch (_error) {
      // Ignore close errors during teardown.
    }

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
