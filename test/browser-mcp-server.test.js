const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EmbeddedBrowserController } = require("../dist/main/embedded-browser.js");
const { BrowserBridgeServer } = require("../dist/main/browser-bridge.js");
const { FakeHost, presentPanel } = require("./helpers/browser-fakes.js");

const SERVER = path.join(__dirname, "..", "dist", "main", "browser-mcp-server.js");
const silent = { info() {}, error() {} };

async function fixture() {
  const host = new FakeHost();
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true });
  controller.beginRendererEpoch();
  controller.onState((s) => { if (s.panelRequested && !s.panelVisible) setImmediate(() => presentPanel(controller)); });
  const bridge = new BrowserBridgeServer(controller, silent);
  await bridge.start();
  const run = controller.issueRun({ conversationId: "A", requestId: "r", policyRevision: 1 });
  return { host, controller, bridge, run, env: bridge.getRunEnv(run) };
}

function startChild(env) {
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  const waiters = [];
  let stderr = "";
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(line);
      for (const w of [...waiters]) w();
    }
  });
  child.stderr.on("data", (c) => (stderr += c));
  let next = 1;
  const send = (obj) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...obj })}\n`);
  const request = async (method, params, timeoutMs = 5000) => {
    const id = next++;
    send({ id, method, params });
    return await waitFor(id, timeoutMs);
  };
  const waitFor = (id, timeoutMs) => new Promise((resolve, reject) => {
    const check = () => {
      const hit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m && m.id === id);
      if (hit) { waiters.splice(waiters.indexOf(check), 1); clearTimeout(timer); resolve(hit); }
    };
    const timer = setTimeout(() => { waiters.splice(waiters.indexOf(check), 1); reject(new Error(`timeout waiting for ${id}`)); }, timeoutMs);
    waiters.push(check);
    check();
  });
  return { child, lines, send, request, stderr: () => stderr, kill: () => child.kill() };
}

test("initialize negotiates only the supported version and advertises a fixed tool set", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  const init = await c.request("initialize", { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "lilto-browser");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  c.send({ method: "notifications/initialized" });
  const list = await c.request("tools/list", {});
  assert.equal(list.result.tools.length, 16);
  assert.ok(list.result.tools.every((t) => t.inputSchema.additionalProperties === false && t.outputSchema));
  assert.equal((await c.request("ping", {})).result && true, true);
  c.kill(); f.bridge.stop();
});

test("protocol errors: bad json, unknown method, unknown tool, invalid args are JSON-RPC errors", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  c.child.stdin.write("{oops\n");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(JSON.parse(c.lines[0]).error.code, -32700);
  assert.equal((await c.request("nope/method", {})).error.code, -32601);
  assert.equal((await c.request("tools/call", { name: "evaluate", arguments: {} })).error.code, -32602);
  assert.equal((await c.request("tools/call", { name: "browser_click", arguments: { leaseId: "x" } })).error.code, -32602);
  assert.equal((await c.request("tools/call", { name: "browser_acquire", arguments: { url: "https://a.example", selector: "x" } })).error.code, -32602);
  c.kill(); f.bridge.stop();
});

test("tools/call returns structured content + JSON text; business errors set isError", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  const status = await c.request("tools/call", { name: "browser_status", arguments: {} });
  assert.equal(status.result.isError, false);
  assert.equal(status.result.structuredContent.ok, true);
  assert.deepEqual(JSON.parse(status.result.content[0].text), status.result.structuredContent);
  const bad = await c.request("tools/call", { name: "browser_acquire", arguments: { url: "file:///etc/passwd" } });
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.structuredContent.error.code, "NAVIGATION_BLOCKED");
  c.kill(); f.bridge.stop();
});

test("screenshot arrives as MCP image content and the base64 is not duplicated in structuredContent", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  const acquire = await c.request("tools/call", { name: "browser_acquire", arguments: { url: "https://example.com/" } });
  const leaseId = acquire.result.structuredContent.result.leaseId;
  f.host.views[0].webContents.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  const shot = await c.request("tools/call", { name: "browser_screenshot", arguments: { leaseId } });
  assert.equal(shot.result.isError, false);
  const image = shot.result.content.find((x) => x.type === "image");
  assert.equal(image.mimeType, "image/png");
  assert.equal(Buffer.from(image.data, "base64").length, 1000);
  assert.equal("imageBase64" in shot.result.structuredContent.result, false);
  assert.equal(shot.result.structuredContent.result.width, 1280);
  assert.equal(JSON.stringify(shot.result.content[0]).includes(image.data), false);
  c.kill(); f.bridge.stop();
});

test("notifications/cancelled aborts the bridge call, sends no response, and the controller stops waiting", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  const acquire = await c.request("tools/call", { name: "browser_acquire", arguments: { url: "https://example.com/" } });
  const leaseId = acquire.result.structuredContent.result.leaseId;
  let polls = 0;
  f.host.views[0].webContents.pageHandlers.hasText = async () => { polls += 1; return { ok: true, present: false }; };
  const id = 900;
  c.send({ id, method: "tools/call", params: { name: "browser_wait", arguments: { leaseId, timeoutMs: 30000, condition: { kind: "text", text: "x", present: true } } } });
  await new Promise((r) => setTimeout(r, 300));
  c.send({ method: "notifications/cancelled", params: { requestId: id } });
  await new Promise((r) => setTimeout(r, 400));
  const frozen = polls;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(polls, frozen);
  assert.equal(c.lines.some((l) => JSON.parse(l).id === id), false, "cancelled request gets no response");
  assert.equal((await c.request("ping", {})).result && true, true, "server still healthy");
  c.kill(); f.bridge.stop();
});

test("stdout carries only JSON-RPC lines, stderr never contains the token", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  await c.request("initialize", {});
  await c.request("tools/call", { name: "browser_status", arguments: {} });
  c.kill(); f.bridge.stop();
  await new Promise((r) => setTimeout(r, 100));
  for (const line of c.lines) {
    const msg = JSON.parse(line);
    assert.equal(msg.jsonrpc, "2.0");
  }
  assert.equal(c.stderr().includes(f.run.token), false);
});

test("unreachable bridge or missing config yields a retryable BROWSER_UNAVAILABLE result, not a crash", async () => {
  const f = await fixture();
  f.bridge.stop();
  const c = startChild(f.env);
  const down = await c.request("tools/call", { name: "browser_status", arguments: {} });
  assert.equal(down.result.isError, true);
  assert.equal(down.result.structuredContent.error.code, "BROWSER_UNAVAILABLE");
  assert.equal(down.result.structuredContent.error.retryable, true);
  c.kill();
  const noEnv = startChild({});
  const missing = await noEnv.request("tools/call", { name: "browser_status", arguments: {} });
  assert.equal(missing.result.structuredContent.error.code, "BROWSER_UNAVAILABLE");
  noEnv.kill();
});

test("non-loopback bridge URLs in the environment are refused", async () => {
  const c = startChild({ LILTO_BROWSER_BRIDGE_URL: "http://evil.example:80", LILTO_BROWSER_BRIDGE_TOKEN: "t" });
  const res = await c.request("tools/call", { name: "browser_status", arguments: {} });
  assert.equal(res.result.structuredContent.error.code, "BROWSER_UNAVAILABLE");
  c.kill();
});

test("child exits when stdin closes", async () => {
  const f = await fixture();
  const c = startChild(f.env);
  await c.request("ping", {});
  const exited = new Promise((r) => c.child.once("exit", r));
  c.child.stdin.end();
  await exited;
  f.bridge.stop();
});
