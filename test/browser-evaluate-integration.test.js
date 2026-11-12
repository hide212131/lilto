const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { EmbeddedBrowserController } = require("../dist/main/embedded-browser.js");
const { BrowserBridgeServer } = require("../dist/main/browser-bridge.js");
const { createBrowserRunSupport } = require("../dist/main/browser-run-support.js");
const { createBrowserSettingsFlow } = require("../dist/main/browser-settings-flow.js");
const { resolveBrowserInstructionUpdate } = require("../dist/main/agent-sdk-config.js");
const { FakeHost, presentPanel } = require("./helpers/browser-fakes.js");

const silent = { info() {}, error() {} };
const SERVER = path.join(__dirname, "..", "dist", "main", "browser-mcp-server.js");

// Release every server/child even if an assertion throws mid-test; leaked handles keep the runner (and `node --test`) alive.
const cleanups = [];
test.after(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function makeBrowser({ evaluateEnabled = false, logger = silent } = {}) {
  const host = new FakeHost();
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true, evaluateEnabled });
  controller.beginRendererEpoch();
  controller.onState((s) => { if (s.panelRequested && !s.panelVisible && host.attached.size > 0) setImmediate(() => presentPanel(controller)); });
  const bridge = new BrowserBridgeServer(controller, logger);
  cleanups.push(() => bridge.stop());
  await bridge.start();
  const support = createBrowserRunSupport({ controller, bridge, serverPath: () => SERVER, execPath: process.execPath });
  return { host, controller, bridge, support };
}

/* ------------------------------------------------------------ run support */

test("run support: env flag + instruction update follow the evaluate setting (16-tool set says evaluate is unavailable)", async () => {
  const off = await makeBrowser({ evaluateEnabled: false });
  const offRun = off.support.resolve({ conversationId: "A", requestId: "r" });
  assert.equal(offRun.kind, "on");
  assert.equal(offRun.launch.env.LILTO_BROWSER_EVALUATE_ENABLED, "0");
  assert.deepEqual(offRun.update, resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: false }));
  assert.equal(offRun.update.state.evaluate, false);
  assert.match(offRun.update.text, /ask the user to do it manually in the panel/);
  assert.match(offRun.update.text, /browser_evaluate is disabled and unavailable/);
  assert.equal(offRun.update.text.includes("[browser_evaluate]"), false, "no evaluate usage section");
  off.bridge.stop();

  const on = await makeBrowser({ evaluateEnabled: true });
  const onRun = on.support.resolve({ conversationId: "A", requestId: "r" });
  assert.equal(onRun.launch.env.LILTO_BROWSER_EVALUATE_ENABLED, "1");
  assert.equal(onRun.update.state.evaluate, true);
  const text = onRun.update.text;
  for (const needle of ["browser_evaluate", "documentEpoch", "frameId", "frames", "64 KiB", "retry", "effect=possible", "untrusted", "synthetic", "never read-only", "another browser or tool", "iframe"]) {
    assert.ok(text.includes(needle), `instructions mention ${needle}`);
  }
  assert.equal(text.includes("ask the user to do it manually in the panel.") && /iframes, file upload/.test(text), false, "no blanket 'iframes: ask the user' any more");
  assert.equal(text.includes("browser_evaluate is disabled"), false);
  on.bridge.stop();
});

/* ------------------------------------------------------------ settings flow */

test("settings flow: evaluate-only change stops runs and revokes tokens but leaves the skill policy alone; issuing resumes after commit", async () => {
  const { controller, bridge, support } = await makeBrowser({ evaluateEnabled: false });
  const calls = [];
  const run = support.begin({ conversationId: "A", requestId: "r" });
  const flow = createBrowserSettingsFlow({ controller, bridge, stopAllRuns: async () => { calls.push("stopAllRuns"); }, syncSkillPolicy: (e) => calls.push(`policy:${e}`), logger: silent });
  const off = { enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false };
  const on = { enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true };
  await flow.prepare(on, off);
  assert.deepEqual(calls, ["stopAllRuns"], "no skill policy change");
  assert.equal(bridge.isRunning, false);
  assert.equal(controller.ownership.resolveToken(run.launch.env.LILTO_BROWSER_BRIDGE_TOKEN), null, "old token rejected");
  assert.equal(support.begin({ conversationId: "A", requestId: "r2" }), null, "issuing is stopped between prepare and commit");
  await flow.commit(on);
  assert.equal(bridge.isRunning, true);
  const next = support.begin({ conversationId: "A", requestId: "r3" });
  assert.ok(next, "capability issuing resumed");
  assert.equal(next.launch.env.LILTO_BROWSER_EVALUATE_ENABLED, "1");
  assert.equal(controller.getPolicyRevision() > 1, true);
  calls.length = 0;
  await flow.prepare({ ...on, autoOpenOnToolUse: false }, on);
  assert.deepEqual(calls, [], "auto-open-only change still interrupts nothing");
  await flow.prepare({ enabled: false, autoOpenOnToolUse: true, evaluateEnabled: true }, on);
  assert.deepEqual(calls, ["stopAllRuns", "policy:false"], "browser ON/OFF still syncs the policy");
  bridge.stop();
});

test("settings flow: failSafe also turns evaluate off", async () => {
  const { controller, bridge } = await makeBrowser({ evaluateEnabled: true });
  const flow = createBrowserSettingsFlow({ controller, bridge, stopAllRuns: async () => {}, syncSkillPolicy: () => {}, logger: silent });
  await flow.failSafe();
  assert.equal(controller.isEnabled(), false);
  assert.equal(controller.isEvaluateEnabled(), false);
  assert.equal(bridge.isRunning, false);
});

/* ------------------------------------------------------------ bridge */

function post(url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: "/command", method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("bridge: a stale/direct browser_evaluate is refused by Main with EVALUATE_DISABLED (effect none, retryable false) when OFF", async () => {
  const { controller, bridge, support } = await makeBrowser({ evaluateEnabled: false });
  const run = support.begin({ conversationId: "A", requestId: "r" });
  const res = await post(run.launch.env.LILTO_BROWSER_BRIDGE_URL, run.launch.env.LILTO_BROWSER_BRIDGE_TOKEN, { commandId: "c1", tool: "browser_evaluate", arguments: { leaseId: "x", documentEpoch: 0, script: "return 1;" } });
  assert.deepEqual(res.json.error, { code: "EVALUATE_DISABLED", message: res.json.error.message, retryable: false, effect: "none" });
  assert.equal(controller.isEvaluateEnabled(), false);
  bridge.stop();
});

test("bridge: an oversized RESPONSE keeps the effect Main reported (evaluate never falls back to 'none')", async () => {
  const stub = {
    ownership: { resolveToken: () => ({ runId: "r", conversationId: "c", requestId: "q", signal: new AbortController().signal }), revokeAllRuns() {} },
    evaluate: async () => ({ ok: true, state: {}, result: { blob: "x".repeat(3 * 1024 * 1024) } }),
    status: () => ({ ok: true, state: {}, result: { blob: "x".repeat(3 * 1024 * 1024) } }),
    snapshot: async () => ({ ok: false, error: { code: "TIMEOUT", message: "m".repeat(3 * 1024 * 1024), retryable: false, effect: "possible" } })
  };
  const bridge = new BrowserBridgeServer(stub, silent);
  cleanups.push(() => bridge.stop());
  await bridge.start();
  const env = bridge.getRunEnv({ token: "t" });
  const ev = await post(env.LILTO_BROWSER_BRIDGE_URL, "t", { commandId: "1", tool: "browser_evaluate", arguments: { leaseId: "l", documentEpoch: 0, script: "x" } });
  assert.equal(ev.json.error.code, "RESULT_TOO_LARGE");
  assert.equal(ev.json.error.effect, "possible");
  assert.equal(ev.json.error.retryable, false);
  const st = await post(env.LILTO_BROWSER_BRIDGE_URL, "t", { commandId: "2", tool: "browser_status", arguments: {} });
  assert.equal(st.json.error.effect, "none", "unchanged behaviour for other tools");
  const sn = await post(env.LILTO_BROWSER_BRIDGE_URL, "t", { commandId: "3", tool: "browser_snapshot", arguments: { leaseId: "l" } });
  assert.equal(sn.json.error.effect, "possible", "a reported effect is never reset");
  bridge.stop();
});

test("bridge logs tool/run/time/result code only: never the script, its result or its error text", async () => {
  const logs = [];
  const logger = { info: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const { controller, bridge, support } = await makeBrowser({ evaluateEnabled: true, logger });
  const run = support.begin({ conversationId: "A", requestId: "r" });
  const env = run.launch.env;
  const acquire = await post(env.LILTO_BROWSER_BRIDGE_URL, env.LILTO_BROWSER_BRIDGE_TOKEN, { commandId: "a", tool: "browser_acquire", arguments: { url: "https://example.com/" } });
  const leaseId = acquire.json.result.leaseId;
  const secret = "SECRET-SCRIPT-BODY-42";
  const res = await post(env.LILTO_BROWSER_BRIDGE_URL, env.LILTO_BROWSER_BRIDGE_TOKEN, { commandId: "b", tool: "browser_evaluate", arguments: { leaseId, documentEpoch: controller.status().state.documentEpoch, script: `return '${secret}';` } });
  assert.equal(res.json.ok, true, JSON.stringify(res.json));
  assert.equal(res.json.result.value.value, secret);
  const logged = JSON.stringify(logs);
  assert.equal(logged.includes(secret), false);
  assert.ok(logs.some((l) => l[1]?.tool === "browser_evaluate" && l[1]?.ok === true));
  bridge.stop();
});

/* ------------------------------------------------------------ MCP child */

function startChild(env) {
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  cleanups.push(() => child.kill("SIGKILL"));
  const lines = [];
  let buf = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  child.stderr.on("data", (c) => (stderr += c));
  let next = 1;
  const request = (method, params, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const id = next++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = lines.map((l) => JSON.parse(l)).find((m) => m.id === id);
      if (hit) { clearInterval(timer); resolve(hit); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(`timeout ${method}`)); }
    }, 10);
  });
  return { child, request, stderr: () => stderr, kill: () => child.kill() };
}

const EVAL_ARGS = { leaseId: "l", documentEpoch: 0, script: "return 1;" };

test("MCP child lists 16 tools without the flag and 17 with it; a direct call to the unlisted tool still reaches Main, which refuses it", async () => {
  const f = await makeBrowser({ evaluateEnabled: false });
  const run = f.support.begin({ conversationId: "A", requestId: "r" });
  const off = startChild({ ...run.launch.env });
  const offList = (await off.request("tools/list", {})).result.tools.map((t) => t.name);
  assert.equal(offList.length, 16);
  assert.equal(offList.includes("browser_evaluate"), false);
  const direct = await off.request("tools/call", { name: "browser_evaluate", arguments: EVAL_ARGS });
  assert.equal(direct.result.isError, true);
  assert.equal(direct.result.structuredContent.error.code, "EVALUATE_DISABLED");
  assert.equal(direct.result.structuredContent.error.effect, "none");
  off.kill();

  const onRun = { ...run.launch.env, LILTO_BROWSER_EVALUATE_ENABLED: "1" };
  const on = startChild(onRun);
  const tools = (await on.request("tools/list", {})).result.tools;
  assert.equal(tools.length, 17);
  const evaluate = tools.find((t) => t.name === "browser_evaluate");
  assert.deepEqual(evaluate.inputSchema.required, ["leaseId", "documentEpoch", "script"]);
  assert.equal(evaluate.inputSchema.additionalProperties, false);
  assert.ok(evaluate.outputSchema.oneOf);
  on.kill();
  f.bridge.stop();
});

test("MCP child: schema violations are -32602 and never reach Controller; so is a serialized request over 64 KiB", async () => {
  const f = await makeBrowser({ evaluateEnabled: true });
  const run = f.support.begin({ conversationId: "A", requestId: "r" });
  const c = startChild(run.launch.env);
  const bad = [
    { ...EVAL_ARGS, extra: 1 }, { leaseId: "l", script: "x" }, { ...EVAL_ARGS, documentEpoch: -1 }, { ...EVAL_ARGS, script: " " },
    { ...EVAL_ARGS, script: "a".repeat(16385) }, { ...EVAL_ARGS, timeoutMs: 99 }, { ...EVAL_ARGS, snapshotId: "s" },
    // 16,384 chars (within the 16 KiB limit) whose JSON escaping makes the request ~98 KB
    { ...EVAL_ARGS, script: "\u0001".repeat(16384) }
  ];
  const before = f.controller.getState().revision;
  for (const args of bad) assert.equal((await c.request("tools/call", { name: "browser_evaluate", arguments: args })).error?.code, -32602, JSON.stringify(args).slice(0, 60));
  assert.equal(f.controller.getState().revision, before, "Controller untouched");
  c.kill();
  f.bridge.stop();
});

test("MCP child: end-to-end acquire -> snapshot frames -> evaluate -> status; structuredContent equals the JSON text", async () => {
  const f = await makeBrowser({ evaluateEnabled: true });
  const run = f.support.begin({ conversationId: "A", requestId: "r" });
  const c = startChild(run.launch.env);
  const call = async (name, args) => (await c.request("tools/call", { name, arguments: args })).result;
  const acquire = await call("browser_acquire", { url: "https://example.com/" });
  const leaseId = acquire.structuredContent.result.leaseId;
  f.host.views[0].webContents.pageHandlers.snapshot = async (a) => ({ ok: true, snapshot: { format: "dom-v1", snapshotId: a.snapshotId, documentEpoch: a.documentEpoch, viewport: { width: 1, height: 1 }, nodes: [], text: "", truncated: false, limitations: [] } });
  f.host.views[0].webContents.addFrame({ url: "https://other.example/x", name: "kid", processId: 2 });
  const snap = await call("browser_snapshot", { leaseId });
  const frames = snap.structuredContent.result.frames;
  assert.equal(frames.length, 2);
  const status = await call("browser_status", {});
  assert.equal(status.structuredContent.result.evaluateEnabled, true);
  const epoch = status.structuredContent.state.documentEpoch;
  const main = await call("browser_evaluate", { leaseId, documentEpoch: epoch, script: "return { t: document.title };" });
  assert.equal(main.isError, false);
  assert.deepEqual(JSON.parse(main.content[0].text), main.structuredContent);
  assert.deepEqual(main.structuredContent.result.value, { type: "json", value: { t: "T" } });
  const kid = await call("browser_evaluate", { leaseId, documentEpoch: epoch, script: "return;", frameId: frames[1].frameId });
  assert.deepEqual(kid.structuredContent.result.value, { type: "undefined" });
  assert.equal(kid.structuredContent.result.frameUrl, "https://other.example/x");
  const syntax = await call("browser_evaluate", { leaseId, documentEpoch: epoch, script: "return (" });
  assert.equal(syntax.isError, true);
  assert.equal(syntax.structuredContent.error.code, "SCRIPT_SYNTAX_ERROR");
  const timeoutPage = f.host.views[0].webContents.mainFrame;
  timeoutPage.exec = (code, runIt) => (code.includes("__ser") ? new Promise(() => {}) : runIt());
  const timeout = await call("browser_evaluate", { leaseId, documentEpoch: epoch, script: "while(true){}", timeoutMs: 200 });
  assert.equal(timeout.structuredContent.error.code, "TIMEOUT");
  assert.equal(timeout.structuredContent.error.effect, "possible");
  assert.equal(timeout.structuredContent.error.retryable, false);
  assert.equal(c.stderr().includes(run.launch.env.LILTO_BROWSER_BRIDGE_TOKEN), false);
  c.kill();
  f.bridge.stop();
});

/** A bridge double that lets the child send a request, then misbehaves. */
function misbehavingBridge(behavior) {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    req.resume();
    req.on("end", () => behavior(req, res));
  });
  cleanups.push(() => server.close());
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, count: () => requests })));
}

test("MCP child: communication failure / garbage response AFTER sending an evaluate is effect=possible, retryable=false, and is never re-sent", async () => {
  for (const [name, behavior] of [
    ["connection dropped", (req) => req.socket.destroy()],
    ["garbage body", (_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("not json"); }],
    ["wrong shape", (_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ hello: 1 })); }]
  ]) {
    const bridge = await misbehavingBridge(behavior);
    const c = startChild({ LILTO_BROWSER_BRIDGE_URL: bridge.url, LILTO_BROWSER_BRIDGE_TOKEN: "t", LILTO_BROWSER_EVALUATE_ENABLED: "1" });
    const res = (await c.request("tools/call", { name: "browser_evaluate", arguments: EVAL_ARGS })).result;
    assert.equal(res.isError, true, name);
    assert.equal(res.structuredContent.error.effect, "possible", name);
    assert.equal(res.structuredContent.error.retryable, false, name);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(bridge.count(), 1, `${name}: exactly one request, no automatic resend`);
    // read-only/other tools keep the old retryable semantics
    const status = (await c.request("tools/call", { name: "browser_status", arguments: {} })).result;
    assert.equal(status.structuredContent.error.effect, "none", name);
    c.kill();
    bridge.server.close();
  }
});

test("MCP child: when the bridge is unreachable (nothing was sent) evaluate is still reported conservatively, other tools stay retryable", async () => {
  const f = await makeBrowser({ evaluateEnabled: true });
  const run = f.support.begin({ conversationId: "A", requestId: "r" });
  f.bridge.stop();
  const c = startChild(run.launch.env);
  const ev = (await c.request("tools/call", { name: "browser_evaluate", arguments: EVAL_ARGS })).result;
  assert.equal(ev.structuredContent.error.effect, "possible");
  assert.equal(ev.structuredContent.error.retryable, false);
  const st = (await c.request("tools/call", { name: "browser_status", arguments: {} })).result;
  assert.equal(st.structuredContent.error.retryable, true);
  c.kill();
});
