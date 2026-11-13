/**
 * Smoke test with the BUNDLED Codex App Server binary, no model needed:
 * real codex -> real lilto_browser MCP child (Electron as node) -> real bridge ->
 * real controller -> real WebContentsView. Also checks skill hiding via skills/list.
 *
 *   xvfb-run -a node_modules/.bin/electron --no-sandbox scripts/verify-app-server-mcp.js
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = (p) => require(path.join(root, "dist", p));
const { EmbeddedBrowserController } = dist("main/embedded-browser.js");
const { createElectronBrowserHost } = dist("main/embedded-browser-electron.js");
const { BrowserBridgeServer } = dist("main/browser-bridge.js");
const { createBrowserRunSupport } = dist("main/browser-run-support.js");
const { withBrowserMcpConfig } = dist("main/agent-sdk-config.js");
const { CodexAppServerClient } = dist("main/codex-app-server-client.js");
const { syncManagedSkillVisibility } = dist("main/skill-runtime-policy.js");
const { resolveBrowserMcpServerPath } = dist("main/app-paths.js");

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? "") }) }); if (!ok) console.error(`FAIL ${name} ${detail ?? ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGETS = { "darwin-arm64": ["codex-darwin-arm64", "aarch64-apple-darwin"], "darwin-x64": ["codex-darwin-x64", "x86_64-apple-darwin"], "linux-x64": ["codex-linux-x64", "x86_64-unknown-linux-musl"], "linux-arm64": ["codex-linux-arm64", "aarch64-unknown-linux-musl"] };
const [PACKAGE_DIR, TRIPLE] = TARGETS[`${process.platform}-${process.arch}`] ?? [];
const BIN = path.join(root, "node_modules/@openai", PACKAGE_DIR ?? "unsupported", "vendor", TRIPLE ?? "unsupported", "bin", "codex");

async function main() {
  const page = "<!doctype html><meta charset=utf-8><title>smoke</title><h1>スモーク</h1><button id=b onclick=\"document.getElementById('o').textContent='clicked'\">押す</button><p id=o></p>";
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const window = new BrowserWindow({ width: 1100, height: 800, show: true });
  await window.loadURL("data:text/html,<body>host</body>");
  window.focus();
  // Input and evaluate are gated on window focus; on a desktop another app can take it at any moment.
  const focusKeeper = setInterval(() => { if (!window.isDestroyed() && !window.isFocused()) { app.focus({ steal: true }); window.focus(); } }, 100);
  const controller = new EmbeddedBrowserController(createElectronBrowserHost(() => window), { enabled: true, autoOpenOnToolUse: true });
  controller.beginRendererEpoch();
  let seq = 0;
  controller.onState((s) => {
    if (s.panelRequested && !s.panelVisible) setImmediate(() => {
      seq += 1;
      controller.updateViewport({ rendererEpoch: s.rendererEpoch, seq, layoutRevision: controller.getState().layoutRevision, viewport: { x: 500, y: 40, width: 580, height: 720 }, hostViewport: { width: 1100, height: 800 }, panelOpen: true, occluded: false, resizing: false });
    });
  });
  const bridge = new BrowserBridgeServer(controller, { info() {}, error() {} });
  await bridge.start();
  const support = createBrowserRunSupport({ controller, bridge, serverPath: () => resolveBrowserMcpServerPath({ appRoot: root }) });

  // --- isolated CODEX_HOME laid out like the app (bundled skills under skills/.system)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-codexhome-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-ws-"));
  const bundled = path.join(home, "skills", ".system");
  for (const name of ["agent-browser", "skill-creator"]) {
    fs.mkdirSync(path.join(bundled, name), { recursive: true });
    fs.writeFileSync(path.join(bundled, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill for smoke test\n---\nbody\n`);
  }
  // A same-named user skill (design 12.4) lives outside .system, which Codex re-syncs on start.
  fs.mkdirSync(path.join(home, "skills", "agent-browser"), { recursive: true });
  fs.writeFileSync(path.join(home, "skills", "agent-browser", "SKILL.md"), "---\nname: agent-browser\ndescription: user copy of agent-browser\n---\nbody\n");
  const policy = (enabled) => syncManagedSkillVisibility({ codexHomeDir: home, workspaceDir: ws, browserEnabled: enabled, bundledSkillsDir: bundled, userSkillsDir: path.join(home, "skills") });
  policy(true);

  const client = new CodexAppServerClient({ codexHomeDir: home, codexCommand: BIN, invocationEnv: {} });
  await client.start();
  const startThread = async (lease) => {
    const out = await client.request("thread/start", {
      cwd: ws, approvalPolicy: "never", sandbox: "danger-full-access", serviceName: "lilto-smoke",
      config: withBrowserMcpConfig(undefined, lease.launch)
    }, 30000);
    return out.thread.id;
  };
  const leaseA = support.resolve({ conversationId: "A", requestId: "ra" });
  const leaseB = support.resolve({ conversationId: "B", requestId: "rb" });
  const threadA = await startThread(leaseA);
  const threadB = await startThread(leaseB);
  check("thread/start accepts config.mcp_servers (instructions travel on turn/start additionalContext)", Boolean(threadA && threadB && threadA !== threadB));

  const status = await client.request("mcpServerStatus/list", { threadId: threadA, serverName: "lilto_browser" }, 30000);
  const entry = (status.data || []).find((s) => s.name === "lilto_browser");
  const toolNames = entry ? Object.keys(entry.tools || {}) : [];
  check("bundled App Server discovers lilto_browser and its 16 tools", entry && toolNames.length === 16 && toolNames.includes("browser_acquire") && toolNames.includes("browser_wait"), JSON.stringify(status).slice(0, 400));

  const call = async (threadId, tool, args) => {
    const res = await client.request("mcpServer/tool/call", { server: "lilto_browser", threadId, tool, arguments: args }, 30000);
    return res;
  };
  const sc = (res) => res.structuredContent ?? JSON.parse(res.content.find((c) => c.type === "text").text);
  const st = sc(await call(threadA, "browser_status", {}));
  check("browser_status through App Server", st.ok === true && st.result.enabled === true, JSON.stringify(st));
  const acq = sc(await call(threadA, "browser_acquire", { url: base }));
  check("acquire opens the page in the real view", acq.ok === true && acq.state.url === base && acq.state.panelVisible === true, JSON.stringify(acq));
  const leaseId = acq.result.leaseId;
  const snap = sc(await call(threadA, "browser_snapshot", { leaseId }));
  const button = snap.result.nodes.find((n) => n.role === "button" && n.name === "押す");
  check("snapshot through App Server contains the button", snap.ok && Boolean(button), JSON.stringify(snap).slice(0, 300));
  const clickRes = sc(await call(threadA, "browser_click", { leaseId, snapshotId: snap.result.snapshotId, ref: button.ref }));
  check("click through App Server", clickRes.ok === true, JSON.stringify(clickRes));
  const waited = sc(await call(threadA, "browser_wait", { leaseId, condition: { kind: "text", text: "clicked", present: true }, timeoutMs: 5000 }));
  check("wait observes the click result", waited.ok === true, JSON.stringify(waited));
  const shotRaw = await call(threadA, "browser_screenshot", { leaseId });
  const image = shotRaw.content.find((c) => c.type === "image");
  check("screenshot arrives as image content through App Server", image && image.mimeType === "image/png" && Buffer.from(image.data, "base64").subarray(1, 4).toString() === "PNG");

  const busy = sc(await call(threadB, "browser_acquire", { url: base }));
  check("parallel run B (own token) gets BROWSER_BUSY, A keeps the lease", busy.ok === false && busy.error.code === "BROWSER_BUSY");
  const stolen = sc(await call(threadB, "browser_snapshot", { leaseId }));
  check("B cannot use A's lease id", stolen.ok === false && stolen.error.code === "LEASE_EXPIRED", JSON.stringify(stolen));

  // revoke A: its MCP child can no longer act
  leaseA.end();
  const afterRevoke = sc(await call(threadA, "browser_status", {}));
  check("revoked run token stops working immediately", afterRevoke.ok === false, JSON.stringify(afterRevoke));
  check("lease freed when the run ended", controller.ownership.getOwner().kind === "none");

  // --- browser_evaluate: OFF => 16 tools + EVALUATE_DISABLED; ON => 17 tools and a real evaluate through codex
  const offAcq = sc(await call(threadB, "browser_acquire", { url: base }));
  const offEval = sc(await call(threadB, "browser_evaluate", { leaseId: offAcq.result?.leaseId ?? "x", documentEpoch: offAcq.state?.documentEpoch ?? 0, script: "return 1" }));
  check("evaluate OFF: a direct browser_evaluate call is refused by Main (EVALUATE_DISABLED, effect none)", offEval.ok === false && offEval.error.code === "EVALUATE_DISABLED" && offEval.error.effect === "none", JSON.stringify(offEval));
  leaseB.end();
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });
  const leaseC = support.resolve({ conversationId: "C", requestId: "rc" });
  const threadC = await startThread(leaseC);
  const statusC = await client.request("mcpServerStatus/list", { threadId: threadC, serverName: "lilto_browser" }, 30000);
  const toolsC = Object.keys((statusC.data || []).find((x) => x.name === "lilto_browser")?.tools || {});
  check("evaluate ON: bundled App Server discovers 17 tools including browser_evaluate", toolsC.length === 17 && toolsC.includes("browser_evaluate"), JSON.stringify(toolsC));
  const instructions = leaseC.update.text ?? "";
  check("evaluate ON: state text carries the evaluate rules; the evaluate-OFF text says it is unavailable", /browser_evaluate/.test(instructions) && /browser_evaluate is disabled/.test(leaseA.update.text) && !/\[browser_evaluate\]/.test(leaseA.update.text));
  window.focus();
  const cAcq = sc(await call(threadC, "browser_acquire", { url: base }));
  check("evaluate ON: acquire", cAcq.ok === true, JSON.stringify(cAcq));
  const cEval = sc(await call(threadC, "browser_evaluate", { leaseId: cAcq.result?.leaseId, documentEpoch: cAcq.state?.documentEpoch, script: "document.getElementById('b').click(); return { title: document.title, clicked: document.getElementById('o').textContent };" }));
  check("evaluate ON: browser_evaluate through App Server returns a JSON value and acts on the page", cEval.ok === true && cEval.result.value.value.title === "smoke" && cEval.result.value.value.clicked === "clicked", JSON.stringify(cEval));
  const cBad = await call(threadC, "browser_evaluate", { leaseId: cAcq.result?.leaseId, documentEpoch: cAcq.state?.documentEpoch, script: "return 1", extra: true }).then(() => null, (error) => error);
  check("evaluate ON: extra properties are rejected as invalid arguments (never reach Main)", cBad && /invalid arguments/.test(String(cBad.message)), String(cBad?.message));
  leaseC.end();

  // no external chromium launched by codex/mcp
  let ps = "";
  try { ps = execFileSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" }); } catch { /* ignore */ }
  // Only descendants of this process count: a desktop machine runs the user's own browsers.
  const rows = ps.split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
  const descendants = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (descendants.has(r.ppid) && !descendants.has(r.pid)) { descendants.add(r.pid); grew = true; } }
  const chromium = rows.filter((r) => descendants.has(r.pid) && /(chrom(e|ium)|google-chrome|playwright)/i.test(r.args) && !/electron/i.test(r.args)).map((r) => `${r.pid} ${r.args}`);
  check("no external Chromium/Playwright process was started", chromium.length === 0, chromium.join("\n"));

  // skills: agent-browser hidden when ON, restored when OFF
  results.push({ name: "INFO: Codex removed the app-placed .system/agent-browser on start", ok: true, info: !fs.existsSync(path.join(bundled, "agent-browser", "SKILL.md")) });
  const enabledOf = async (forceReload) => {
    const r = await client.request("skills/list", { cwds: [ws], forceReload }, 30000);
    const skills = (r.data || []).flatMap((d) => d.skills || []);
    if (process.env.VERIFY_DEBUG) console.log("SKILLS", JSON.stringify(skills.map((x) => ({ n: x.name, e: x.enabled, p: x.path }))), fs.readFileSync(path.join(home, "config.toml"), "utf8"));
    return Object.fromEntries(skills.filter((s) => ["agent-browser", "skill-creator"].includes(s.name)).map((s) => [s.name, s.enabled]));
  };
  const on = await enabledOf(true);
  check("ON: (user-dir) agent-browser is disabled, skill-creator untouched", on["agent-browser"] === false && on["skill-creator"] === true, JSON.stringify(on));
  policy(false);
  const off = await enabledOf(true);
  check("OFF: agent-browser is restored", off["agent-browser"] === true && off["skill-creator"] === true, JSON.stringify(off));

  leaseB.end();
  clearInterval(focusKeeper);
  client.close();
  bridge.stop();
  controller.dispose();
  server.close();
  const failed = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "test/artifacts/verify-app-server-mcp.json"), JSON.stringify({ codex: "0.163.0", electron: process.versions.electron, total: results.length, failed: failed.length, results }, null, 2));
  console.log(`verify-app-server-mcp: ${results.length - failed.length}/${results.length} checks passed`);
  exitNow(failed.length ? 1 : 0);
}
/**
 * A force-crashed renderer can make Electron's orderly (synchronous) shutdown block under Xvfb,
 * so results are already on disk; leave through the process-level exit instead of app.exit().
 */
function exitNow(code) {
  try { process.reallyExit(code); } catch { app.exit(code); }
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(2); });
