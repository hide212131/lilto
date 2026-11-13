/**
 * Live UI check for Issue #42 against the REAL built app (Lit renderer + real Main + real IPC), isolated
 * user data / CODEX_HOME, no model. The window is minimized with the real native `BrowserWindow.minimize()`
 * (called through the Main-process Node inspector of a throw-away app instance), then the panel is opened
 * with a user navigation.
 * It proves the Lit layout path (open sync, viewport measurement, native bounds) while minimized and the
 * state flags after minimize / restore. Agent tool delivery is covered by verify-embedded-browser.js and
 * verify-app-server-mcp.js (which cannot exercise the Lit UI).
 *
 *   npm run build && node scripts/verify-minimized-ui.js
 */
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");
const { connectToElectronApp } = require("./electron-playwright");

const root = path.resolve(__dirname, "..");
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? "") }) });
  if (!ok) console.error(`FAIL ${name} ${detail ?? ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return await new Promise((resolve) => {
    const server = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>ui-fixture${req.url}</title><h1>UIフィクスチャ</h1><div id=m style="position:fixed;right:0;bottom:0;width:100px;height:100px;background:#c33"></div>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const port = await freePort();
  const inspectPort = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-min-ui-"));
  const electronBin = process.platform === "win32"
    ? path.join(root, "node_modules", "electron", "dist", "electron.exe")
    : process.platform === "darwin"
      ? path.join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
      : path.join(root, "node_modules", "electron", "dist", "electron");
  const env = { ...process.env, LILTO_E2E_MOCK: "1", CODEX_HOME: path.join(userDataDir, "codex"), HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: "", https_proxy: "", NO_PROXY: "", no_proxy: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronBin, [".", `--remote-debugging-port=${port}`, `--inspect=${inspectPort}`, `--user-data-dir=${userDataDir}`], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
  let logs = "";
  app.stdout.on("data", (c) => { logs += c; });
  app.stderr.on("data", (c) => { logs += c; });
  let browser;
  let connectError = null;
  for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
    try {
      ({ browser, page: hostPage } = await connectToElectronApp(port, { timeoutMs: 5000 }));
    } catch (error) {
      connectError = error;
      await sleep(500);
    }
  }
  if (!browser) throw new Error(`could not connect: ${connectError?.message}\n${logs.slice(-1500)}`);
  const page = hostPage;
  const state = () => page.evaluate(async () => (await window.lilto.browser.getState()).state);
  const until = async (predicate, ms = 8000) => {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
      last = await state();
      if (predicate(last)) return last;
      await sleep(150);
    }
    return last;
  };
  // Main-process control (real native window calls) through the Node inspector.
  const wsUrl = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json();
        if (list[0]?.webSocketDebuggerUrl) return list[0].webSocketDebuggerUrl;
      } catch { /* not ready */ }
      await sleep(250);
    }
    throw new Error("Main inspector not available");
  })();
  const inspector = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { inspector.onopen = resolve; inspector.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  inspector.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const mainEval = (expression) => new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, (message) => (message.error || message.result?.exceptionDetails ? reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails).slice(0, 300))) : resolve(message.result.result.value)));
    inspector.send(JSON.stringify({ id: nextId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  const W = `process.mainModule.require("electron").BrowserWindow.getAllWindows().find((w) => /file:/.test(w.webContents.getURL()))`;
  const setWindow = (windowState) => mainEval(windowState === "minimized" ? `${W}.minimize()` : `${W}.restore()`);
  const windowState = async () => ((await mainEval(`${W}.isMinimized()`)) ? "minimized" : "normal");

  await until((s) => s.rendererEpoch !== "");
  await sleep(1000);

  // baseline: visible
  await page.evaluate((url) => window.lilto.browser.navigate(url), `${base}/visible`);
  const visible = await until((s) => s.panelRequested && s.operationReady && s.url.endsWith("/visible"));
  check("ui: visible baseline opens the panel (panelVisible and operationReady)", visible.panelVisible === true && visible.operationReady === true && visible.windowMinimized === false, JSON.stringify(visible));

  // minimize, then reload the panel contents through the Lit UI path
  await setWindow("minimized");
  for (let i = 0; i < 30 && (await windowState()) !== "minimized"; i += 1) await sleep(100);
  check("ui: the native window is minimized", (await windowState()) === "minimized");
  const minimized = await until((s) => s.windowMinimized === true);
  check("ui: minimize keeps the panel logically open and operable (panelRequested, operationReady=true, panelVisible=false)", minimized.panelRequested === true && minimized.operationReady === true && minimized.panelVisible === false && minimized.windowMinimized === true, JSON.stringify(minimized));

  // close the panel while minimized, then open it again while minimized (Lit open sync + layout report)
  await page.evaluate(() => window.lilto.browser.setPresentation({ open: false, occluded: false, resizing: false }));
  const closed = await until((s) => s.panelRequested === false);
  check("ui: panel closed while minimized", closed.panelRequested === false, JSON.stringify(closed));
  await page.evaluate((url) => window.lilto.browser.navigate(url), `${base}/while-minimized`);
  const reopened = await until((s) => s.panelRequested && s.operationReady && s.url.endsWith("/while-minimized"), 10000);
  check("ui: opening the panel while minimized prepares an operable surface through the real Lit layout report (no restore)", reopened.operationReady === true && reopened.panelVisible === false && reopened.windowMinimized === true && (await windowState()) === "minimized", JSON.stringify(reopened));

  // restore: latest page shown, layout matches the placeholder
  await setWindow("normal");
  for (let i = 0; i < 30 && (await windowState()) === "minimized"; i += 1) await sleep(100);
  const restored = await until((s) => s.windowMinimized === false && s.panelVisible === true && s.operationReady === true, 10000);
  check("ui: restore shows the latest page (panelVisible=true, operationReady=true)", restored.panelVisible === true && restored.operationReady === true && restored.url.endsWith("/while-minimized"), JSON.stringify(restored));
  const content = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith("/while-minimized"));
  const placeholder = await page.locator("lilt-browser-panel .viewport").boundingBox();
  const size = content ? await content.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })) : null;
  check("ui: after restore the native page sits exactly over the panel placeholder", Boolean(size && placeholder) && Math.abs(size.width - placeholder.width) <= 2 && Math.abs(size.height - placeholder.height) <= 2, JSON.stringify({ size, placeholder }));

  // repeated minimize / restore keeps flipping the flags and never loses the panel
  let loopOk = true;
  const loopDetail = [];
  for (let i = 0; i < 10; i += 1) {
    await setWindow("minimized");
    const m = await until((s) => s.windowMinimized === true, 5000);
    await setWindow("normal");
    const r = await until((s) => s.windowMinimized === false && s.panelVisible === true && s.operationReady === true, 8000);
    const ok = m.windowMinimized === true && m.operationReady === true && m.panelVisible === false && r.panelVisible === true && r.operationReady === true;
    loopDetail.push({ i, ok });
    loopOk = loopOk && ok;
  }
  check("ui: 10x minimize/restore keeps the panel operable and shown after each restore", loopOk, JSON.stringify(loopDetail.filter((l) => !l.ok)));

  fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(root, "test/artifacts/verify-minimized-ui-host.png") });
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(root, "test/artifacts/verify-minimized-ui.json"), JSON.stringify({ platform: process.platform, total: results.length, failed: failed.length, results }, null, 2));
  console.log(`verify-minimized-ui: ${results.length - failed.length}/${results.length} checks passed`);
  await browser.close().catch(() => {});
  inspector.close();
  app.kill();
  server.close();
  process.exit(failed.length ? 1 : 0);
}

let hostPage;
main().catch((error) => { console.error(error); process.exit(2); });
