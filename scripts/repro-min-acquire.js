/**
 * Narrow repro for Issue #42 W1: "first acquire while minimized" (autoOpen) occasionally comes back
 * PANEL_NOT_READY on real Windows hardware even though the minimized-fallback layout exists to cover
 * exactly this case. Unlike verify-embedded-browser.js, this script does NOT simulate a renderer
 * answering the layout request at all, so the only path to success is the fallback in
 * EmbeddedBrowserController.applyMinimizedFallbackLayout().
 *
 * On failure (and always, for comparison) it dumps the controller's internal bounds/measurement state
 * next to the host's and the real BrowserWindow's own geometry, so a stuck fallback can be diagnosed
 * without re-running the whole verify suite.
 *
 *   electron scripts/repro-min-acquire.js [--out test/artifacts/repro-min-acquire.json]
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { EmbeddedBrowserController } = require(path.join(root, "dist/main/embedded-browser.js"));
const { createElectronBrowserHost, attachControllerToWindow } = require(path.join(root, "dist/main/embedded-browser-electron.js"));

const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const OUT = path.resolve(root, argValue("--out", "test/artifacts/repro-min-acquire.json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<title>repro</title><p>repro page</p>");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/** Dumps controller-private fields (lastBounds/savedBounds/measured/needsRelayout) for diagnosis. */
function controllerInternals(controller) {
  return {
    lastBounds: controller.lastBounds ?? null,
    savedBounds: controller.savedBounds ?? null,
    measured: controller.measured ?? null,
    needsRelayout: controller.needsRelayout,
    panelRequested: controller.panelRequested,
    surfaceReady: controller.surfaceReady,
    layoutRevision: controller.layoutRevision,
    rendererEpoch: controller.rendererEpoch
  };
}

function windowGeometry(window) {
  if (!window || window.isDestroyed()) return null;
  return {
    isMinimized: window.isMinimized(),
    getBounds: window.getBounds(),
    getContentSize: window.getContentSize(),
    getContentBounds: window.getContentBounds(),
    getNormalBounds: window.getNormalBounds()
  };
}

async function main() {
  const WATCHDOG_MS = Number(process.env.LILTO_REPRO_WATCHDOG_MS ?? 60000);
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    console.error(`WATCHDOG: repro-min-acquire did not finish within ${WATCHDOG_MS}ms`);
    exitNow(1);
  }, WATCHDOG_MS);

  const { server, base } = await startServer();
  const window = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html;charset=utf-8,<body style='margin:0'><p>host</p></body>");
  await sleep(1000); // let the freshly shown window settle before minimizing it

  const beforeMinimize = windowGeometry(window);

  const host = createElectronBrowserHost(() => window);
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false });
  attachControllerToWindow(controller, window);
  controller.beginRendererEpoch();

  // Native minimize; no renderer ever answers the resulting layout request (that is the point of this repro).
  const seenMinimize = new Promise((resolve) => window.once("minimize", resolve));
  window.minimize();
  await Promise.race([seenMinimize, sleep(3000)]);
  for (let i = 0; i < 30 && !window.isMinimized(); i += 1) await sleep(100);
  await sleep(300);

  const afterMinimize = windowGeometry(window);
  const hostBeforeAcquire = {
    getContentSize: host.getContentSize(),
    getNormalContentSize: host.getNormalContentSize(),
    getWindowState: host.getWindowState()
  };

  const run = controller.issueRun({ conversationId: "repro", requestId: "repro-1", policyRevision: 1 });
  const handle = { runId: run.runId, conversationId: "repro", signal: controller.ownership.resolveToken(run.token).signal };

  const startedAt = Date.now();
  const result = await controller.acquire(handle, { url: `${base}/`, timeoutMs: 4000 });
  const elapsedMs = Date.now() - startedAt;

  // Post-acquire diagnostics (Issue #42 W3): on a successful acquire while still minimized, capture the
  // tool-visible viewport (snapshot's result.viewport, i.e. the page's own window.innerWidth/innerHeight
  // via the isolated-world runtime), the WebContentsView's real native bounds, and a second, independent
  // read of window.innerWidth/innerHeight straight from the page. This is to tell apart "the surface was
  // never given real bounds" (a product bug) from "bounds were real but Windows never laid out / painted
  // a view whose ancestor window is minimized" (a Chromium/compositor limitation outside product control).
  let postAcquireSnapshot = null;
  if (result.ok) {
    const leaseId = result.result.leaseId;
    const snap = await controller.snapshot(handle, { leaseId });
    const view = controller.view;
    let viewBounds = null;
    let pageInnerSize = null;
    try { viewBounds = view && typeof view.getBounds === "function" ? view.getBounds() : null; } catch (error) { viewBounds = { error: String(error) }; }
    try {
      pageInnerSize = await view.webContents.executeJavaScript("[window.innerWidth, window.innerHeight, document.readyState]");
    } catch (error) {
      pageInnerSize = { error: String(error) };
    }
    postAcquireSnapshot = {
      snapshotOk: snap.ok,
      snapshotViewport: snap.ok ? snap.result.viewport : null,
      snapshotError: snap.ok ? null : snap.error,
      viewBounds,
      pageInnerSize,
      windowMinimizedAtSnapshot: window.isMinimized()
    };
  }

  const report = {
    electron: process.versions.electron,
    platform: process.platform,
    release: os.release(),
    startedAt: new Date().toISOString(),
    elapsedMs,
    result,
    ok: result.ok === true,
    windowMinimizedAtAcquire: window.isMinimized(),
    beforeMinimize,
    afterMinimize,
    hostBeforeAcquire,
    hostAfterAcquire: {
      getContentSize: host.getContentSize(),
      getNormalContentSize: host.getNormalContentSize(),
      getWindowState: host.getWindowState()
    },
    windowAfterAcquire: windowGeometry(window),
    controllerInternalsAfterAcquire: controllerInternals(controller),
    controllerState: controller.getState(),
    postAcquireSnapshot
  };

  clearTimeout(watchdog);
  if (watchdogFired) return;

  server.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`repro written to ${OUT}`);
  console.log(`summary: ok=${report.ok} elapsedMs=${elapsedMs} error=${result.ok ? "(none)" : JSON.stringify(result.error)}`);
  if (postAcquireSnapshot) {
    console.log(`post-acquire: snapshotViewport=${JSON.stringify(postAcquireSnapshot.snapshotViewport)} viewBounds=${JSON.stringify(postAcquireSnapshot.viewBounds)} pageInnerSize=${JSON.stringify(postAcquireSnapshot.pageInnerSize)}`);
  }
  exitNow(0);
}

function exitNow(code) {
  try {
    process.reallyExit(code);
  } catch {
    app.exit(code);
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(2);
});
