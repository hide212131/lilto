const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sessionName = "lilto-electron-e2e-live";
const cdpPort = process.env.LILTO_E2E_CDP_PORT || "9223";
const screenshotPath = path.join(rootDir, "test", "artifacts", "electron-e2e-agent-skills-live.png");
const e2eMagicWord = "[[LILTO_SKILL_E2E_MAGIC]]";
const e2eSkillName = "lilto-e2e-example-title";

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

  const shell = process.platform === "win32" ? "npx.cmd" : "npx";
  run(shell, ["agent-browser", "--version"]);
}

function cleanupPriorE2ESkills() {
  const userSkillsDir = path.join(os.homedir(), ".pi", "skills");
  if (!fs.existsSync(userSkillsDir)) return [];

  const removed = [];
  const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(userSkillsDir, entry.name);
    const skillPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;

    let content = "";
    try {
      content = fs.readFileSync(skillPath, "utf8");
    } catch (_error) {
      continue;
    }

    if (!content.includes(e2eMagicWord)) {
      continue;
    }

    fs.rmSync(skillDir, { recursive: true, force: true });
    removed.push(skillDir);
  }

  return removed;
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

function getMessagesText() {
  return evalJs(
    "Array.from(document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-message-list')?.shadowRoot?.querySelectorAll('.msg') ?? []).map(el => el.textContent?.trim()).join('\\n')"
  );
}

function isSettingsModalOpen() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-settings-modal')?.shadowRoot?.querySelector('.modal-backdrop')?.classList?.contains('open') ?? false"
  );
  return result === "true";
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

function isSendDisabled() {
  const result = evalJs(
    "document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-composer')?.shadowRoot?.querySelector('button')?.disabled ?? true"
  );
  return result === "true";
}

async function waitForStatus(expected, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = getStatusText();
    if (expected.some((s) => text.includes(s))) return text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for status. Expected one of: ${expected.join(", ")}. Last: '${getStatusText()}'`);
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

async function waitForSendEnabled(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isSendDisabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for send button to be enabled (Claude 未認証の可能性)");
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
    `Timed out waiting for response fragments: ${expectedFragments.join(", ")}\nMessages: ${getMessagesText()}`
  );
}

async function waitForSkillFileContainsMagic(timeoutMs = 120000) {
  const skillPath = path.join(os.homedir(), ".pi", "skills", e2eSkillName, "SKILL.md");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, "utf8");
      if (content.includes(e2eMagicWord)) {
        return skillPath;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for generated skill file with magic word: ${skillPath}`);
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  preflightChecks();
  const removedSkills = cleanupPriorE2ESkills();
  console.log(`Pre-cleanup removed ${removedSkills.length} E2E skill(s) by magic word match`);

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", ".bin", "electron.cmd")
      : path.join(rootDir, "node_modules", ".bin", "electron");

  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: rootDir,
    env: { ...process.env, LILTO_E2E_MOCK: "0" },
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
    console.log("Waiting for CDP...");
    await waitForCdpReady();
    agentBrowser(["connect", cdpPort]);
    console.log("Connected to CDP");

    const title = agentBrowser(["get", "title"]);
    if (!title.includes("Lilt-o")) throw new Error(`Unexpected title: ${title}`);
    console.log(`✓ Title: '${title}'`);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const appExists = evalJs("!!document.querySelector('lilt-app')");
    if (appExists !== "true") throw new Error("lilt-app element not found in DOM");
    console.log("✓ lilt-app rendered");

    clickSettingsButton();
    await waitForModalOpen();
    console.log("✓ Settings modal opened");

    switchToClaudeProvider();
    await new Promise((resolve) => setTimeout(resolve, 600));

    const authStatus = getAuthStatusText();
    if (!authStatus.includes("認証")) {
      throw new Error(`Claude auth status text is unexpected: '${authStatus}'`);
    }
    console.log(`✓ Claude auth status: '${authStatus}'`);

    clickSettingsClose();
    await waitForModalClose();
    console.log("✓ Settings modal closed");

    const currentStatus = await waitForStatus(["待機中", "Claude 認証が必要です"]);
    if (currentStatus.includes("認証が必要")) {
      throw new Error(`Claude is not authenticated: '${currentStatus}'`);
    }

    await waitForSendEnabled();

    const baselinePrompt = [
      "/skill:agent-browser",
      "Open https://example.com and fetch the page title.",
      "Return a single sentence that contains the exact title.",
      "Do not use mock values."
    ].join("\n");

    console.log("Step 1/3: obtaining baseline result...");
    fillComposerText(baselinePrompt);
    clickComposerSend();
    const baselineMessages = await waitForResponseContains(["Example Domain"]);
    if (baselineMessages.includes("[E2E_MOCK]")) {
      throw new Error("Mock response detected in live E2E output");
    }

    const createSkillPrompt = [
      "さっき取得した情報取得手順を再現できるようにスキル化して。",
      `スキル名は ${e2eSkillName} に固定すること。`,
      "保存先は ~/.pi/skills/<skill-name>/SKILL.md にすること。",
      `SKILL.md に固定マジックワード ${e2eMagicWord} を必ず含めること。`,
      "このスキルは https://example.com のタイトルを取得して返す手順を実行できるようにすること。"
    ].join("\n");

    console.log("Step 2/3: creating replay skill...");
    fillComposerText(createSkillPrompt);
    clickComposerSend();
    const generatedSkillPath = await waitForSkillFileContainsMagic();
    console.log(`✓ Generated skill verified: ${generatedSkillPath}`);

    const replayPrompt = [
      `/skill:${e2eSkillName}`,
      "https://example.com のタイトルを取得して、1文で返して。"
    ].join("\n");

    console.log("Step 3/3: replaying result via generated skill...");
    fillComposerText(replayPrompt);
    clickComposerSend();

    const replayMessages = await waitForResponseContains(["Example Domain"]);
    if (!replayMessages.includes("Example Domain")) {
      throw new Error("Replay skill did not reproduce baseline result");
    }

    const finalStatus = await waitForStatus(["待機中"]);
    console.log(`✓ Final status: '${finalStatus}'`);

    agentBrowser(["screenshot", screenshotPath]);
    console.log(`✓ Final screenshot: ${screenshotPath}`);

    console.log("\nLive Agent Skills E2E success!");
    console.log("Conversation:");
    replayMessages
      .split("\n")
      .filter(Boolean)
      .forEach((m) => console.log(`  - ${m}`));
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
