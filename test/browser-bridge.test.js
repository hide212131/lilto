const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EmbeddedBrowserController } = require("../dist/main/embedded-browser.js");
const { BrowserBridgeServer } = require("../dist/main/browser-bridge.js");
const { FakeHost, presentPanel } = require("./helpers/browser-fakes.js");

const silent = { info() {}, error() {} };

async function setup() {
  const host = new FakeHost();
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true });
  controller.beginRendererEpoch();
  controller.onState((s) => { if (s.panelRequested && !s.panelVisible) setImmediate(() => presentPanel(controller)); });
  const bridge = new BrowserBridgeServer(controller, silent);
  await bridge.start();
  const run = controller.issueRun({ conversationId: "A", requestId: "r", policyRevision: 1 });
  const env = bridge.getRunEnv(run);
  return { host, controller, bridge, run, env, url: env.LILTO_BROWSER_BRIDGE_URL };
}

function raw({ url, headers = {}, body = "", method = "POST", path = "/command" }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const auth = (token, extra = {}) => ({ authorization: `Bearer ${token}`, "content-type": "application/json", ...extra });
const cmd = (tool, args = {}, commandId = `c-${Math.random()}`) => JSON.stringify({ commandId, tool, arguments: args });

test("env for the MCP child contains url, token and ELECTRON_RUN_AS_NODE only", async () => {
  const { env, bridge, run } = await setup();
  assert.deepEqual(Object.keys(env).sort(), ["ELECTRON_RUN_AS_NODE", "LILTO_BROWSER_BRIDGE_TOKEN", "LILTO_BROWSER_BRIDGE_URL"]);
  assert.match(env.LILTO_BROWSER_BRIDGE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(env.LILTO_BROWSER_BRIDGE_TOKEN, run.token);
  bridge.stop();
});

test("only POST /command; 401 for missing/wrong token; Origin and Host are enforced", async () => {
  const { bridge, url, env } = await setup();
  assert.equal((await raw({ url, method: "GET" })).status, 404);
  assert.equal((await raw({ url, path: "/other", headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN), body: cmd("browser_status") })).status, 404);
  assert.equal((await raw({ url, headers: { "content-type": "application/json" }, body: cmd("browser_status") })).status, 401);
  assert.equal((await raw({ url, headers: auth("0".repeat(64)), body: cmd("browser_status") })).status, 401);
  assert.equal((await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN, { origin: "https://evil.example" }), body: cmd("browser_status") })).status, 403);
  assert.equal((await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN, { host: "evil.example" }), body: cmd("browser_status") })).status, 403);
  assert.equal((await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN, { "content-type": "text/plain" }), body: cmd("browser_status") })).status, 415);
  const ok = await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN), body: cmd("browser_status") });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).ok, true);
  bridge.stop();
});

test("request body is capped at 64 KiB; malformed/unknown-key bodies are rejected", async () => {
  const { bridge, url, env } = await setup();
  const headers = auth(env.LILTO_BROWSER_BRIDGE_TOKEN);
  const big = await raw({ url, headers, body: cmd("browser_status", { pad: "x".repeat(70 * 1024) }) }).catch((e) => ({ status: 0, error: e }));
  assert.ok(big.status === 413 || big.status === 0);
  assert.equal((await raw({ url, headers, body: "{not json" })).status, 400);
  assert.equal((await raw({ url, headers, body: JSON.stringify({ commandId: "c", tool: "browser_status", arguments: {}, conversationId: "B" }) })).status, 400);
  assert.equal((await raw({ url, headers, body: JSON.stringify({ commandId: "c", tool: "not_a_tool", arguments: {} }) })).status, 400);
  assert.equal((await raw({ url, headers, body: JSON.stringify({ tool: "browser_status" }) })).status, 400);
  bridge.stop();
});

test("identity comes from the token only: a body conversationId/run cannot impersonate another run", async () => {
  const { bridge, url, env, controller } = await setup();
  const b = controller.issueRun({ conversationId: "B", requestId: "rb", policyRevision: 1 });
  const acquire = await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN), body: cmd("browser_acquire", { url: "https://example.com/" }) });
  const lease = JSON.parse(acquire.body).result.leaseId;
  // B (valid token) tries to use A's lease id.
  const stolen = JSON.parse((await raw({ url, headers: auth(b.token), body: cmd("browser_release", { leaseId: lease }) })).body);
  assert.equal(stolen.ok, false);
  assert.equal(stolen.error.code, "LEASE_EXPIRED");
  const busy = JSON.parse((await raw({ url, headers: auth(b.token), body: cmd("browser_acquire", { url: "https://example.com/" }) })).body);
  assert.equal(busy.error.code, "BROWSER_BUSY");
  bridge.stop();
});

test("revoked run tokens stop working immediately; stop() revokes everything", async () => {
  const { bridge, url, env, controller, run } = await setup();
  controller.ownership.revokeRun(run.runId);
  assert.equal((await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN), body: cmd("browser_status") })).status, 401);
  const second = controller.issueRun({ conversationId: "A", requestId: "r2", policyRevision: 1 });
  bridge.stop();
  assert.equal(controller.ownership.resolveToken(second.token), null);
  assert.equal(bridge.isRunning, false);
  await assert.rejects(raw({ url, headers: auth(second.token), body: cmd("browser_status") }));
});

test("invalid tool arguments are rejected with a structured error and never reach the controller", async () => {
  const { bridge, url, env, host } = await setup();
  const res = JSON.parse((await raw({ url, headers: auth(env.LILTO_BROWSER_BRIDGE_TOKEN), body: cmd("browser_acquire", { url: "https://x.example", extra: 1 }) })).body);
  assert.equal(res.ok, false);
  assert.match(res.error.message, /not allowed/);
  assert.equal(host.views.length, 0);
  bridge.stop();
});

test("duplicate in-flight commandId is rejected (409) and concurrency is capped (429)", async () => {
  const { bridge, url, env, host, controller } = await setup();
  const headers = auth(env.LILTO_BROWSER_BRIDGE_TOKEN);
  const acquire = JSON.parse((await raw({ url, headers, body: cmd("browser_acquire", { url: "https://example.com/" }) })).body);
  const lease = acquire.result.leaseId;
  host.views[0].webContents.pageHandlers.hasText = async () => ({ ok: true, present: false });
  const waitBody = (id) => cmd("browser_wait", { leaseId: lease, timeoutMs: 1500, condition: { kind: "text", text: "never", present: true } }, id);
  const first = raw({ url, headers, body: waitBody("same") });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await raw({ url, headers, body: waitBody("same") })).status, 409);
  const many = Array.from({ length: 12 }, (_, i) => raw({ url, headers, body: waitBody(`m${i}`) }));
  const results = await Promise.all(many);
  assert.ok(results.some((r) => r.status === 429), "some requests were rejected as overload");
  controller.ownership.revokeAllRuns();
  await first;
  bridge.stop();
});

test("client disconnect aborts the pending operation (no orphaned wait)", async () => {
  const { bridge, url, env, host } = await setup();
  const headers = auth(env.LILTO_BROWSER_BRIDGE_TOKEN);
  const lease = JSON.parse((await raw({ url, headers, body: cmd("browser_acquire", { url: "https://example.com/" }) })).body).result.leaseId;
  let polls = 0;
  host.views[0].webContents.pageHandlers.hasText = async () => { polls += 1; return { ok: true, present: false }; };
  const u = new URL(url);
  const req = http.request({ host: u.hostname, port: u.port, path: "/command", method: "POST", headers }, () => {});
  req.on("error", () => {});
  req.end(cmd("browser_wait", { leaseId: lease, timeoutMs: 30000, condition: { kind: "text", text: "never", present: true } }));
  await new Promise((r) => setTimeout(r, 250));
  req.destroy();
  await new Promise((r) => setTimeout(r, 300));
  const after = polls;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(polls, after, "polling stopped after disconnect");
  bridge.stop();
});

test("oversized results are replaced by RESULT_TOO_LARGE", async () => {
  const { bridge, url, env, host } = await setup();
  const headers = auth(env.LILTO_BROWSER_BRIDGE_TOKEN);
  const lease = JSON.parse((await raw({ url, headers, body: cmd("browser_acquire", { url: "https://example.com/" }) })).body).result.leaseId;
  host.views[0].webContents.pageHandlers.getText = async () => ({ ok: true, text: "あ".repeat(900_000), truncated: false });
  const res = JSON.parse((await raw({ url, headers, body: cmd("browser_get_text", { leaseId: lease }) })).body);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "RESULT_TOO_LARGE");
  bridge.stop();
});
