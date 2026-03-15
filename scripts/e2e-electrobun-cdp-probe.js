const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const cdpPort = process.env.LILTO_E2E_CDP_PORT || "9224";

function resolveDesktopRuntimeBinary() {
  const binDir = path.join(rootDir, "node_modules", ".bin");
  const candidates = process.platform === "win32" ? ["electrobun.cmd"] : ["electrobun"];

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
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJsonVersion(timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${cdpPort}/json/version`;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch (_error) {
      // retry
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

async function fetchJsonList() {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to fetch /json/list: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function waitForPageTarget(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = await fetchJsonList().catch(() => []);
    if (Array.isArray(targets) && targets.some((target) => target.type === "page")) {
      return targets;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for page target from CDP /json/list on port ${cdpPort}`);
}

async function main() {
  const electrobunBin = resolveDesktopRuntimeBinary();
  const buildResult = spawnSync(electrobunBin, ["build"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LILTO_E2E_USE_CEF: "1",
      LILTO_E2E_CDP_PORT: cdpPort
    },
    encoding: "utf8"
  });

  if (buildResult.status !== 0) {
    throw new Error(
      [
        "Electrobun build failed before CDP probe.",
        buildResult.stdout,
        buildResult.stderr
      ].filter(Boolean).join("\n")
    );
  }

  const launcherPath = resolveBuiltLauncherPath();
  if (!fs.existsSync(launcherPath)) {
    throw new Error(`Electrobun launcher not found after build: ${launcherPath}`);
  }

  const appProcess = spawn(launcherPath, [], {
    cwd: path.dirname(launcherPath),
    env: {
      ...process.env,
      LILTO_E2E_USE_CEF: "1",
      LILTO_E2E_CDP_PORT: cdpPort
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let appLogs = "";
  appProcess.stdout.on("data", (chunk) => {
    appLogs += chunk.toString();
  });
  appProcess.stderr.on("data", (chunk) => {
    appLogs += chunk.toString();
  });

  try {
    console.log(`Waiting for CDP on port ${cdpPort}...`);
    const versionPayload = await waitForJsonVersion();
    const targetList = await waitForPageTarget();

    console.log("CDP version payload:");
    console.log(JSON.stringify(versionPayload, null, 2));
    console.log("CDP target list:");
    console.log(JSON.stringify(targetList, null, 2));

    const hasDebuggerUrl = Boolean(versionPayload.webSocketDebuggerUrl);
    const hasPageTarget = Array.isArray(targetList) && targetList.some((target) => target.type === "page");
    if (!hasDebuggerUrl) {
      throw new Error("CDP endpoint responded but webSocketDebuggerUrl is missing");
    }
    if (!hasPageTarget) {
      throw new Error("CDP endpoint responded but no page target was found in /json/list");
    }

    console.log("CDP probe success!");
  } finally {
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
