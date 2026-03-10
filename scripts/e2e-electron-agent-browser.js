const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { normalizeCommandArgs, normalizeWorkingDirectory, resolveCliCommand } = require("./command-compat");

const rootDir = path.resolve(__dirname, "..");
const screenshotPath = path.join(rootDir, "test", "artifacts", "electron-e2e.png");
const expectedIsolationLabel = "Windows 分離実行で Bash / Write ツールを実行する";

function shouldUseShellForCommand(commandPath) {
  if (process.platform !== "win32") return false;
  const lower = String(commandPath || "").toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

function resolveAgentBrowserCommand() {
  if (process.platform === "win32") {
    const binDir = path.join(rootDir, "node_modules", "agent-browser", "bin");
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const candidates = [
      path.join(binDir, `agent-browser-win32-${arch}.exe`),
      path.join(binDir, "agent-browser-win32-x64.exe"),
      path.join(binDir, "agent-browser-win32-arm64.exe")
    ];

    for (const candidate of candidates) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && stat.size > 0) {
          return { cmd: candidate, prefixArgs: [] };
        }
      } catch {
        // try next candidate
      }
    }
  }

  return { cmd: resolveCliCommand("npx"), prefixArgs: ["agent-browser"] };
}

const agentBrowserCommand = resolveAgentBrowserCommand();

function run(cmd, args, options = {}) {
  const resolvedCmd = resolveCliCommand(cmd);
  const resolvedArgs = normalizeCommandArgs(args);
  const result = spawnSync(resolvedCmd, resolvedArgs, {
    cwd: normalizeWorkingDirectory(rootDir),
    shell: shouldUseShellForCommand(resolvedCmd),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_BROWSER_HOME: path.join(rootDir, "node_modules", "agent-browser")
    },
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

function terminateProcessTree(pid) {
  if (!pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: normalizeWorkingDirectory(rootDir),
      shell: false,
      encoding: "utf8"
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already exited
  }
}

async function waitForCdpReady(timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${currentCdpPort}/json/version`;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // wait
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

function agentBrowser(args) {
  return run(agentBrowserCommand.cmd, [...agentBrowserCommand.prefixArgs, "--cdp", currentCdpPort, ...args]);
}

function evalJs(js) {
  return agentBrowser(["eval", js]);
}

async function waitForCondition(jsExpression, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = evalJs(jsExpression).replaceAll("\"", "").trim();
    if (result === "true") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for condition: ${jsExpression}`);
}

function clickSettingsButton() {
  evalJs(
    `(() => {
      function findByTitle(root, title) {
        for (const el of root.querySelectorAll('*')) {
          if (el.getAttribute && el.getAttribute('title') === title) return el;
          if (el.shadowRoot) {
            const nested = findByTitle(el.shadowRoot, title);
            if (nested) return nested;
          }
        }
        return null;
      }
      const button = findByTitle(document, 'Settings');
      if (!button) return 'missing';
      button.click();
      return 'ok';
    })()`
  );
}

let currentCdpPort = "9222";

async function reserveOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a CDP port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(port));
      });
    });
  });
}

async function main() {
  currentCdpPort = await reserveOpenPort();
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", "electron", "dist", "electron.exe")
      : path.join(rootDir, "node_modules", ".bin", "electron");

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${currentCdpPort}`], {
    cwd: rootDir,
    shell: shouldUseShellForCommand(electronBin),
    env: {
      ...process.env,
      LILTO_E2E_MOCK: "1"
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

    const title = agentBrowser(["get", "title"]);
    if (!title.includes("Lilt-o")) {
      throw new Error(`Unexpected title: ${title}`);
    }

    await waitForCondition("!!document.querySelector('lilt-app')");
    clickSettingsButton();
    await waitForCondition(
      "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.modal-backdrop')?.classList?.contains('open') ?? false"
    );

    const labelText = evalJs(
      `(() => {
        function findInput(root, id) {
          for (const el of root.querySelectorAll('*')) {
            if (el.id === id) return el;
            if (el.shadowRoot) {
              const nested = findInput(el.shadowRoot, id);
              if (nested) return nested;
            }
          }
          return null;
        }
        const input = findInput(document, 'use-windows-sandbox-tools');
        return input ? ((input.parentElement && input.parentElement.textContent) || '').trim() : '';
      })()`
    ).replaceAll("\"", "");

    if (!labelText.includes(expectedIsolationLabel)) {
      throw new Error(`Unexpected isolation label: ${labelText}`);
    }

    agentBrowser(["screenshot", screenshotPath]);
    if (!fs.existsSync(screenshotPath)) {
      throw new Error(`Screenshot not created: ${screenshotPath}`);
    }

    console.log("Electron E2E smoke passed");
    console.log(`Title: ${title}`);
    console.log(`Isolation label: ${labelText}`);
    console.log(`Screenshot: ${screenshotPath}`);
  } finally {
    terminateProcessTree(electron.pid);
    await new Promise((resolve) => {
      electron.once("exit", () => resolve());
      setTimeout(resolve, 3000);
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
