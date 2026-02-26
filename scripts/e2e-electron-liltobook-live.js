const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeCommandArgs, normalizeWorkingDirectory, resolveCliCommand } = require("./command-compat");

const rootDir = path.resolve(__dirname, "..");
const sessionName = "lilto-electron-e2e-liltobook-live";
const cdpPort = process.env.LILTO_E2E_CDP_PORT || "9224";
const screenshotPath = path.join(rootDir, "test", "artifacts", "electron-e2e-liltobook-live.png");
const proposalDelayMs = Number(process.env.LILTO_E2E_HEARTBEAT_PROPOSAL_DELAY_MS || "6000");
const heartbeatIntervalMs = Number(process.env.LILTO_E2E_HEARTBEAT_INTERVAL_MS || "2000");

function run(cmd, args, options = {}) {
  const resolvedCmd = resolveCliCommand(cmd);
  const resolvedArgs = normalizeCommandArgs(args);
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
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  return result.stdout.trim();
}

function preflightChecks() {
  if (process.env.LILTO_E2E_MOCK === "1") {
    throw new Error("LILTO_E2E_MOCK=1 では live E2E を実行できません。unset してください。");
  }

  const authPath = path.join(rootDir, ".lilto-auth.json");
  if (!fs.existsSync(authPath)) {
    throw new Error(".lilto-auth.json が見つかりません。先に Claude OAuth でログインしてください。");
  }

  const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
  if (!parsed || !parsed.anthropic || typeof parsed.anthropic !== "object") {
    throw new Error(".lilto-auth.json に anthropic 認証情報がありません。先に Claude OAuth でログインしてください。");
  }

  const shell = resolveCliCommand("npx");
  run(shell, ["agent-browser", "--version"]);
}

function listUserSkillDirs() {
  const userSkillsDir = path.join(os.homedir(), ".pi", "skills");
  if (!fs.existsSync(userSkillsDir)) return [];
  return fs
    .readdirSync(userSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function diffNewSkills(before, after) {
  const beforeSet = new Set(before);
  return after.filter((name) => !beforeSet.has(name));
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
  const shell = resolveCliCommand("npx");
  return run(shell, ["agent-browser", "--session", sessionName, ...args]);
}

function evalJs(js) {
  return agentBrowser(["eval", js]);
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

function isSettingsModalOpen() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.modal-backdrop')?.classList?.contains('open') ?? false"
  );
  return result === "true";
}

function isSendDisabled() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('button')?.disabled ?? true"
  );
  return result === "true";
}

function getMessagesText() {
  return evalJs(
    "Array.from(document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-message-list')?.shadowRoot?.querySelectorAll('.msg') ?? []).map(el => el.textContent?.trim()).join('\\n')"
  );
}

async function waitForModalOpen(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isSettingsModalOpen()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for settings modal to open");
}

async function waitForModalClose(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isSettingsModalOpen()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for settings modal to close");
}

async function waitForSendEnabled(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isSendDisabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for send button to be enabled");
}

async function waitForResponseContains(expectedFragments, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = getMessagesText();
    const allPresent = expectedFragments.every((fragment) => messages.includes(fragment));
    if (allPresent) return messages;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for response fragments: ${expectedFragments.join(", ")}\\nMessages: ${getMessagesText()}`
  );
}

async function waitForProposalWithRetry(timeoutMs = 240000) {
  const start = Date.now();
  let lastRetryAt = 0;
  while (Date.now() - start < timeoutMs) {
    const messages = getMessagesText();
    if (messages.includes("再利用スキル候補を提案します") && messages.includes("作成してよければ「はい」")) {
      return messages;
    }
    if (messages.includes("AGENT_BUSY") && Date.now() - lastRetryAt > 6000) {
      fillComposerText("提案内容をもう一度表示して");
      clickComposerSend();
      lastRetryAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for proposal fragments. Messages: ${getMessagesText()}`
  );
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  preflightChecks();

  const skillsBefore = listUserSkillDirs();
  console.log(`Initial user skills: ${skillsBefore.length}`);

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", ".bin", "electron.cmd")
      : path.join(rootDir, "node_modules", ".bin", "electron");

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    env: {
      ...process.env,
      LILTO_E2E_MOCK: "0",
      LILTO_HEARTBEAT_PROPOSAL_DELAY_MS: String(proposalDelayMs),
      LILTO_HEARTBEAT_INTERVAL_MS: String(heartbeatIntervalMs)
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

  let failure = null;
  try {
    console.log("Waiting for CDP...");
    await waitForCdpReady();
    agentBrowser(["connect", cdpPort]);
    console.log("Connected to CDP");

    clickSettingsButton();
    await waitForModalOpen();
    switchToClaudeProvider();
    await new Promise((resolve) => setTimeout(resolve, 600));
    clickSettingsClose();
    await waitForModalClose();
    await waitForSendEnabled();

    console.log("Step 1/5: run a real interaction...");
    fillComposerText("/skill:agent-browser\\nOpen https://example.com and return the exact title.");
    clickComposerSend();
    const baselineMessages = await waitForResponseContains(["Example Domain"], 60000);
    if (baselineMessages.includes("[E2E_MOCK]")) {
      throw new Error("Mock response detected in live E2E output");
    }

    console.log("Step 2/5: mark session as completed...");
    fillComposerText("ありがとう、解決しました");
    clickComposerSend();
    await waitForResponseContains(["ありがとう", "解決"], 120000).catch(() => {
      // provider output is free-form; completion signal is user text, so ignore strict assistant text mismatch.
    });

    console.log("Step 3/5: wait heartbeat and trigger proposal...");
    await new Promise((resolve) => setTimeout(resolve, proposalDelayMs + heartbeatIntervalMs + 1500));
    fillComposerText("次は何をすればいい？");
    clickComposerSend();
    await waitForProposalWithRetry(240000);

    console.log("Step 4/5: approve proposal and create skill...");
    fillComposerText("はい");
    clickComposerSend();
    await waitForResponseContains(["承認を受けてスキルを作成しました"]);

    const skillsAfterCreate = listUserSkillDirs();
    const createdSkills = diffNewSkills(skillsBefore, skillsAfterCreate);
    if (createdSkills.length !== 1) {
      throw new Error(`Expected exactly 1 new skill, got ${createdSkills.length}: ${createdSkills.join(", ")}`);
    }
    console.log(`✓ Created skill: ${createdSkills[0]}`);

    console.log("Step 5/5: repeated approval should not create another skill...");
    fillComposerText("はい");
    clickComposerSend();
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const skillsAfterSecondYes = listUserSkillDirs();
    const createdAfterSecondYes = diffNewSkills(skillsBefore, skillsAfterSecondYes);
    if (createdAfterSecondYes.length !== 1) {
      throw new Error(`Duplicate skills detected: ${createdAfterSecondYes.join(", ")}`);
    }
    console.log("✓ No duplicate skill created");

    agentBrowser(["screenshot", screenshotPath]);
    console.log(`✓ Final screenshot: ${screenshotPath}`);

    console.log("\\nLive liltobook heartbeat E2E success!");
    console.log("Created skill list delta:", createdAfterSecondYes);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    try {
      agentBrowser(["screenshot", screenshotPath]);
      console.log(`Captured failure screenshot: ${screenshotPath}`);
    } catch (_screenshotError) {
      // ignore screenshot failure
    }
  } finally {
    try {
      agentBrowser(["close"]);
    } catch (_error) {
      // ignore cleanup errors
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

  if (failure) {
    throw failure;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
