const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mock } = require("node:test");

const { AgentRuntime, createCodexThreadFromAppServer } = require("../dist/main/agent-sdk.js");
const { CodexAppServerClient } = require("../dist/main/codex-app-server-client.js");
const { EmbeddedBrowserController } = require("../dist/main/embedded-browser.js");
const { BrowserBridgeServer } = require("../dist/main/browser-bridge.js");
const { createBrowserRunSupport } = require("../dist/main/browser-run-support.js");
const { createBrowserSettingsFlow } = require("../dist/main/browser-settings-flow.js");
const { BROWSER_DEVELOPER_INSTRUCTIONS, withBrowserMcpConfig } = require("../dist/main/agent-sdk-config.js");
const { syncManagedSkillVisibility, collectAgentBrowserSkillPaths } = require("../dist/main/skill-runtime-policy.js");
const { resolveBrowserMcpServerPath } = require("../dist/main/app-paths.js");
const { FakeHost } = require("./helpers/browser-fakes.js");

const silent = { info() {}, error() {} };

async function makeBrowser(enabled = true) {
  const controller = new EmbeddedBrowserController(new FakeHost(), { enabled, autoOpenOnToolUse: true });
  controller.beginRendererEpoch();
  const bridge = new BrowserBridgeServer(controller, silent);
  if (enabled) await bridge.start();
  const support = createBrowserRunSupport({ controller, bridge, serverPath: () => "/app/dist/main/browser-mcp-server.js", execPath: "/usr/bin/node" });
  return { controller, bridge, support };
}

function mockAppServer() {
  const requests = [];
  const mocks = [
    mock.method(CodexAppServerClient.prototype, "start", async function () {}),
    mock.method(CodexAppServerClient.prototype, "request", async function (method, params) {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: `thread-${requests.length}` } };
      if (method === "turn/start") return { turn: { id: `turn-${requests.length}` } };
      return {};
    }),
    mock.method(CodexAppServerClient.prototype, "nextNotification", async function () {
      return { method: "turn/completed", params: { turn: { status: "completed" } } };
    }),
    mock.method(CodexAppServerClient.prototype, "close", function () {})
  ];
  return { requests, restore: () => mocks.forEach((m) => m.mock.restore()) };
}

async function drain(thread, options) {
  const run = await thread.runStreamed("hello", options);
  for await (const _ of run.events) { /* drain */ }
}

test("browserRun adds mcp_servers.lilto_browser + developerInstructions to thread/start and turn/start, keeping cron", async () => {
  const server = mockAppServer();
  try {
    const thread = await createCodexThreadFromAppServer({ apiKey: "k", cwd: "/w", codexHomeDir: "/c", homeDir: "/h", config: { mcp_servers: { cron: { command: "x" } } } });
    const launch = { command: "/usr/bin/node", args: ["/app/browser-mcp-server.js"], env: { LILTO_BROWSER_BRIDGE_URL: "http://127.0.0.1:1", LILTO_BROWSER_BRIDGE_TOKEN: "tok-A", ELECTRON_RUN_AS_NODE: "1" } };
    await drain(thread, { browserRun: { launch, developerInstructions: BROWSER_DEVELOPER_INSTRUCTIONS } });
    const start = server.requests.find((r) => r.method === "thread/start").params;
    assert.deepEqual(Object.keys(start.config.mcp_servers).sort(), ["cron", "lilto_browser"]);
    assert.deepEqual(start.config.mcp_servers.lilto_browser, { command: launch.command, args: launch.args, env: launch.env, enabled: true });
    assert.equal(start.developerInstructions, BROWSER_DEVELOPER_INSTRUCTIONS);
    const turn = server.requests.find((r) => r.method === "turn/start").params;
    assert.equal(turn.config.mcp_servers.lilto_browser.env.LILTO_BROWSER_BRIDGE_TOKEN, "tok-A");
  } finally { server.restore(); }
});

test("without browserRun (OFF/heartbeat) the key is absent and no developerInstructions are sent", async () => {
  const server = mockAppServer();
  try {
    const thread = await createCodexThreadFromAppServer({ apiKey: "k", cwd: "/w", codexHomeDir: "/c", homeDir: "/h", config: { mcp_servers: { cron: { command: "x" } } } });
    await drain(thread, {});
    const start = server.requests.find((r) => r.method === "thread/start").params;
    assert.equal("lilto_browser" in start.config.mcp_servers, false);
    assert.equal("developerInstructions" in start, false);
    assert.equal(JSON.stringify(start).includes("BRIDGE_TOKEN"), false);
  } finally { server.restore(); }
});

test("a cached thread never keeps a token: two runs on the same thread get their own tokens", async () => {
  const server = mockAppServer();
  try {
    const thread = await createCodexThreadFromAppServer({ apiKey: "k", cwd: "/w", codexHomeDir: "/c", homeDir: "/h" });
    const launch = (token) => ({ launch: { command: "n", args: ["s"], env: { LILTO_BROWSER_BRIDGE_TOKEN: token } }, developerInstructions: "d" });
    await drain(thread, { browserRun: launch("tok-1") });
    await drain(thread, { browserRun: launch("tok-2") });
    await drain(thread, {});
    const starts = server.requests.filter((r) => r.method === "thread/start" || r.method === "thread/resume");
    const tokens = starts.map((r) => r.params.config?.mcp_servers?.lilto_browser?.env?.LILTO_BROWSER_BRIDGE_TOKEN);
    assert.deepEqual(tokens, ["tok-1", "tok-2", undefined]);
  } finally { server.restore(); }
});

test("withBrowserMcpConfig: undefined launch leaves config untouched (no key)", () => {
  const base = { mcp_servers: { cron: { command: "x" } } };
  assert.equal(withBrowserMcpConfig(base, undefined), base);
  assert.equal(withBrowserMcpConfig(undefined, undefined), undefined);
});

function fakeRuntime(browser, sessions) {
  return new AgentRuntime({
    authService: { getState: () => ({ phase: "authenticated" }), getApiKey: () => null },
    workspaceDir: "/w",
    browserSupport: browser,
    createSession: async () => ({
      id: "t",
      async runStreamed(_input, options) {
        sessions.push(options?.browserRun ?? null);
        return { events: (async function* () { yield { type: "item.completed", item: { id: "m", type: "agent_message", text: "ok" } }; })() };
      }
    })
  });
}
const settingsFor = () => ({
  activeProvider: "oauth", oauthProvider: "openai-codex", oauthModelId: "m",
  customProvider: { name: "", baseUrl: "", apiKey: "", modelId: "" }, networkProxy: { useProxy: false },
  windowsSandbox: { mode: "off", privateDesktop: true }, chatSettings: { enterToSend: false, globalShortcut: "x" },
  heartbeatSettings: { enabled: false, intervalMinutes: 30 }, browserSettings: { enabled: true, autoOpenOnToolUse: true }, updatedAt: 1
});

test("AgentRuntime: ordinary conversations get a per-run browser capability that is revoked after the run", async () => {
  const { controller, bridge, support } = await makeBrowser(true);
  const seen = [];
  const runtime = fakeRuntime(support, seen);
  const result = await runtime.submitPrompt("hi", settingsFor(), { requestId: "r1", conversationId: "conv-A" });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  const token = seen[0].launch.env.LILTO_BROWSER_BRIDGE_TOKEN;
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(seen[0].launch.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(seen[0].launch.args[0].endsWith("browser-mcp-server.js"), true);
  assert.equal(controller.ownership.resolveToken(token), null, "token revoked once the run finished");
  bridge.stop();
});

test("AgentRuntime: parallel conversations receive different tokens; heartbeat and conversation-less runs get none", async () => {
  const { bridge, support } = await makeBrowser(true);
  const seen = [];
  const runtime = fakeRuntime(support, seen);
  await Promise.all([
    runtime.submitPrompt("a", settingsFor(), { requestId: "ra", conversationId: "A" }),
    runtime.submitPrompt("b", settingsFor(), { requestId: "rb", conversationId: "B" })
  ]);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0].launch.env.LILTO_BROWSER_BRIDGE_TOKEN, seen[1].launch.env.LILTO_BROWSER_BRIDGE_TOKEN);
  seen.length = 0;
  await runtime.submitPrompt("hb", settingsFor(), { requestId: "rh", conversationId: "A", mode: "heartbeat", freshContext: true });
  await runtime.submitPrompt("anon", settingsFor(), { requestId: "rn" });
  assert.deepEqual(seen, [null, null]);
  bridge.stop();
});

test("AgentRuntime: browser OFF (or bridge stopped) means new runs get no browser MCP", async () => {
  const off = await makeBrowser(false);
  const seen = [];
  await fakeRuntime(off.support, seen).submitPrompt("x", settingsFor(), { requestId: "r", conversationId: "A" });
  assert.deepEqual(seen, [null]);
  const on = await makeBrowser(true);
  on.bridge.stop();
  await fakeRuntime(on.support, seen).submitPrompt("x", settingsFor(), { requestId: "r", conversationId: "A" });
  assert.deepEqual(seen, [null, null]);
});

test("AgentRuntime.stopAllRuns aborts the turn, revokes tokens and returns once the run has wound down", async () => {
  const { controller, bridge, support } = await makeBrowser(true);
  let started; const startedP = new Promise((r) => (started = r));
  let tokenSeen = null;
  const runtime = new AgentRuntime({
    authService: { getState: () => ({ phase: "authenticated" }), getApiKey: () => null },
    workspaceDir: "/w",
    browserSupport: support,
    createSession: async () => ({
      id: "t",
      async runStreamed(_i, options) {
        tokenSeen = options.browserRun.launch.env.LILTO_BROWSER_BRIDGE_TOKEN;
        started();
        return { events: (async function* () { if (options.signal.aborted) return; await new Promise((res) => options.signal.addEventListener("abort", res, { once: true })); })() };
      }
    })
  });
  const pending = runtime.submitPrompt("long", settingsFor(), { requestId: "r", conversationId: "A" });
  await startedP;
  await runtime.stopAllRuns(2000);
  assert.equal(runtime.isBusy, false);
  assert.equal(controller.ownership.resolveToken(tokenSeen), null);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ABORTED");
  bridge.stop();
});

test("settings flow: ON->OFF stops issuing, revokes, stops bridge+runs, syncs policy, then commits; OFF->ON restarts the bridge", async () => {
  const { controller, bridge, support } = await makeBrowser(true);
  const calls = [];
  const run = support.begin({ conversationId: "A", requestId: "r" });
  const flow = createBrowserSettingsFlow({
    controller, bridge,
    stopAllRuns: async () => { calls.push("stopAllRuns"); },
    syncSkillPolicy: (enabled) => calls.push(`policy:${enabled}`),
    logger: silent
  });
  const on = { enabled: true, autoOpenOnToolUse: true };
  const off = { enabled: false, autoOpenOnToolUse: true };
  await flow.prepare(off, on);
  assert.deepEqual(calls, ["stopAllRuns", "policy:false"]);
  assert.equal(bridge.isRunning, false);
  assert.equal(controller.ownership.resolveToken(run.launch.env.LILTO_BROWSER_BRIDGE_TOKEN), null);
  assert.equal(support.begin({ conversationId: "A", requestId: "r2" }), null);
  await flow.commit(off);
  assert.equal(controller.isEnabled(), false);
  await flow.prepare(on, off);
  await flow.commit(on);
  assert.equal(bridge.isRunning, true);
  assert.ok(support.begin({ conversationId: "A", requestId: "r3" }));
  calls.length = 0;
  await flow.prepare({ enabled: true, autoOpenOnToolUse: false }, on);
  assert.deepEqual(calls, [], "auto-open-only change does not interrupt anything");
  bridge.stop();
});

test("settings flow: a failing skill policy sync leaves the browser stopped (failSafe)", async () => {
  const { controller, bridge } = await makeBrowser(true);
  const flow = createBrowserSettingsFlow({ controller, bridge, stopAllRuns: async () => {}, syncSkillPolicy: () => { throw new Error("disk full"); }, logger: silent });
  await assert.rejects(flow.prepare({ enabled: false, autoOpenOnToolUse: true }, { enabled: true, autoOpenOnToolUse: true }), /disk full/);
  await flow.failSafe();
  assert.equal(controller.isEnabled(), false);
  assert.equal(bridge.isRunning, false);
});

/* ------------------------------------------------------------ skill policy */

function skillHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-skillpolicy-"));
  const codexHomeDir = path.join(root, "codex");
  const bundledSkillsDir = path.join(codexHomeDir, "skills", ".system");
  const userSkillsDir = path.join(codexHomeDir, "skills");
  const workspaceDir = path.join(root, "ws");
  for (const [dir, name] of [[bundledSkillsDir, "agent-browser"], [bundledSkillsDir, "skill-creator"]]) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\nbody\n`);
  }
  fs.mkdirSync(workspaceDir, { recursive: true });
  return { root, codexHomeDir, bundledSkillsDir, userSkillsDir, workspaceDir, config: path.join(codexHomeDir, "config.toml") };
}

test("skill policy: ON hides bundled agent-browser (and a same-named user skill); OFF restores; other settings are preserved", () => {
  const h = skillHome();
  fs.mkdirSync(path.join(h.userSkillsDir, "agent-browser"), { recursive: true });
  fs.writeFileSync(path.join(h.userSkillsDir, "agent-browser", "SKILL.md"), "---\nname: agent-browser\ndescription: mine\n---\nx\n");
  fs.writeFileSync(h.config, 'model = "x"\n\n[features]\nfoo = true\n');
  const options = { codexHomeDir: h.codexHomeDir, workspaceDir: h.workspaceDir, bundledSkillsDir: h.bundledSkillsDir, userSkillsDir: h.userSkillsDir };
  syncManagedSkillVisibility({ ...options, browserEnabled: true });
  const on = fs.readFileSync(h.config, "utf8");
  assert.match(on, /model = "x"/);
  assert.match(on, /\[features\]\nfoo = true/);
  const bundledPath = path.join(h.bundledSkillsDir, "agent-browser", "SKILL.md");
  const userPath = path.join(h.userSkillsDir, "agent-browser", "SKILL.md");
  assert.ok(on.includes(`path = ${JSON.stringify(bundledPath)}\nenabled = false`));
  assert.ok(on.includes(`path = ${JSON.stringify(userPath)}\nenabled = false`));
  assert.equal(on.includes("skill-creator"), false);
  syncManagedSkillVisibility({ ...options, browserEnabled: true });
  assert.equal(fs.readFileSync(h.config, "utf8"), on, "idempotent");
  syncManagedSkillVisibility({ ...options, browserEnabled: false });
  const off = fs.readFileSync(h.config, "utf8");
  assert.equal(off.includes("skills.config"), false);
  assert.match(off, /model = "x"/);
  assert.match(off, /foo = true/);
});

test("skill policy: repo-skill disables are kept in both modes; a user's own disable outside the block survives OFF and is not duplicated", () => {
  const h = skillHome();
  const repoSkill = path.join(h.workspaceDir, ".codex", "skills", "demo", "SKILL.md");
  fs.mkdirSync(path.dirname(repoSkill), { recursive: true });
  fs.writeFileSync(repoSkill, "---\nname: demo\ndescription: d\n---\n");
  const bundledPath = path.join(h.bundledSkillsDir, "agent-browser", "SKILL.md");
  fs.writeFileSync(h.config, `[[skills.config]]\npath = ${JSON.stringify(bundledPath)}\nenabled = false\n`);
  const options = { codexHomeDir: h.codexHomeDir, workspaceDir: h.workspaceDir, bundledSkillsDir: h.bundledSkillsDir, userSkillsDir: h.userSkillsDir };
  syncManagedSkillVisibility({ ...options, browserEnabled: true });
  let text = fs.readFileSync(h.config, "utf8");
  assert.equal(text.split(JSON.stringify(bundledPath)).length - 1, 1, "user's entry not duplicated");
  assert.ok(text.includes(JSON.stringify(repoSkill)));
  syncManagedSkillVisibility({ ...options, browserEnabled: false });
  text = fs.readFileSync(h.config, "utf8");
  assert.ok(text.includes(JSON.stringify(bundledPath)), "user's explicit disable stays after OFF");
  assert.ok(text.includes(JSON.stringify(repoSkill)));
  assert.deepEqual(collectAgentBrowserSkillPaths(options).includes(bundledPath), true);
});

/* ------------------------------------------------------------------- paths */

test("resolveBrowserMcpServerPath prefers the asar-unpacked copy, falls back to dist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-paths-"));
  const appRoot = path.join(root, "resources", "app.asar");
  const unpacked = path.join(root, "resources", "app.asar.unpacked", "dist", "main", "browser-mcp-server.js");
  assert.equal(resolveBrowserMcpServerPath({ appRoot }), path.join(appRoot, "dist", "main", "browser-mcp-server.js"));
  fs.mkdirSync(path.dirname(unpacked), { recursive: true });
  fs.writeFileSync(unpacked, "");
  assert.equal(resolveBrowserMcpServerPath({ appRoot }), unpacked);
  const dev = path.join(root, "dev");
  assert.equal(resolveBrowserMcpServerPath({ appRoot: dev }), path.join(dev, "dist", "main", "browser-mcp-server.js"));
});
