/**
 * Windows-only experiment for Issue #42 W4: candidate ways to make a minimized window's compositor
 * actually present a new frame, so `screenshot()` would not have to fall back to SCREENSHOT_UNAVAILABLE
 * (added in W2 after CI showed capturePage silently returns a stale image while minimized on Windows,
 * and CDP Page.captureScreenshot times out outright).
 *
 * Raw Electron only (no controller). Each candidate is tried in isolation against a freshly set
 * generation marker, while the window stays minimized throughout (none of the candidates are allowed
 * to restore/show/focus the window — that would defeat the point of Issue #42). For each candidate we
 * record: whether `beginFrameSubscription` ever fired (the same signal W2's product fix relies on),
 * and whether a subsequent capturePage actually shows the new generation color. It records facts; it
 * does not assert a verdict (verify-embedded-browser.js / the shipped product code does that).
 *
 *   electron scripts/probe-win-capture.js [--out test/artifacts/probe-win-capture.json]
 *
 * Intended to run on Windows only; it records process.platform in the report so a run on another
 * platform is self-evidently out of scope rather than silently misleading.
 */
const { app, BrowserWindow, WebContentsView, nativeImage } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const OUT = path.resolve(root, argValue("--out", "test/artifacts/probe-win-capture.json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>probe</title>
<body style="margin:0;background:#fff">
<div id="mark" style="position:fixed;right:0;bottom:0;width:300px;height:300px;background:#000"></div>
<script>
window.setGen = (n) => { document.getElementById("mark").style.background = "rgb(" + [(n * 37) % 256, (n * 91 + 40) % 256, (n * 53 + 100) % 256].join(",") + ")"; return n; };
</script>`;

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

function pixelAt(image, fx, fy) {
  const { width, height } = image.getSize();
  if (!width || !height) return null;
  const bitmap = image.toBitmap();
  const x = Math.min(width - 1, Math.max(0, Math.round(width * fx)));
  const y = Math.min(height - 1, Math.max(0, Math.round(height * fy)));
  const o = (y * width + x) * 4;
  // Electron bitmaps are BGRA on macOS/Windows/Linux little-endian.
  return { rgb: [bitmap[o + 2], bitmap[o + 1], bitmap[o]], size: { width, height } };
}
const expectedColor = (n) => [(n * 37) % 256, (n * 91 + 40) % 256, (n * 53 + 100) % 256];
const close = (a, b) => Boolean(a) && a.every((v, i) => Math.abs(v - b[i]) <= 16);

/** Waits for one beginFrameSubscription callback, or times out. Never un-minimizes anything. */
function awaitFramePresented(wc, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (presented) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        wc.endFrameSubscription();
      } catch {
        /* ignore */
      }
      resolve(presented);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      wc.beginFrameSubscription(false, () => finish(true));
    } catch {
      finish(false);
    }
  });
}

async function captureAndCheck(wc, gen) {
  try {
    const image = await Promise.race([wc.capturePage(undefined, { stayHidden: true }), sleep(5000).then(() => { throw new Error("capturePage timeout 5s"); })]);
    const p = pixelAt(image, 0.97, 0.97);
    return { pixel: p?.rgb ?? null, expected: expectedColor(gen), fresh: close(p?.rgb, expectedColor(gen)) };
  } catch (error) {
    return { error: String(error.message ?? error) };
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.warn(`WARNING: this probe targets win32; running on ${process.platform} is out of scope for its conclusions.`);
  }
  const { server, base } = await startServer();
  const window = new BrowserWindow({ width: 1000, height: 700, show: true, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html;charset=utf-8,<body style='margin:0'><p>probe host</p></body>");
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: "probe-win-capture" } });
  window.contentView.addChildView(view);
  view.setBounds({ x: 100, y: 50, width: 800, height: 600 });
  view.setVisible(true);
  const wc = view.webContents;
  await wc.loadURL(`${base}/probe`);
  await sleep(500);
  wc.setBackgroundThrottling(false);
  window.webContents.setBackgroundThrottling(false);

  const minimizeNow = async () => {
    const minimized = new Promise((resolve) => window.once("minimize", resolve));
    window.minimize();
    await Promise.race([minimized, sleep(3000)]);
    for (let i = 0; i < 30 && !window.isMinimized(); i += 1) await sleep(100);
    await sleep(800);
  };
  await minimizeNow();

  let gen = 300;
  const nextGen = async () => {
    gen += 1;
    await wc.executeJavaScript(`window.setGen(${gen})`);
    return gen;
  };

  /** One candidate remedy: apply it, wait briefly, then check both frame-subscription and capture freshness. */
  async function tryCandidate(name, apply) {
    const g = await nextGen();
    await sleep(100);
    const stillMinimizedBefore = window.isMinimized();
    const framePresentedPromise = awaitFramePresented(wc, 3000);
    let applyError = null;
    try {
      await apply();
    } catch (error) {
      applyError = String(error.message ?? error);
    }
    const framePresented = await framePresentedPromise;
    const stillMinimizedAfter = window.isMinimized();
    const capture = await captureAndCheck(wc, g);
    const result = { name, stillMinimizedBefore, stillMinimizedAfter, applyError, framePresented, capture };
    console.log("candidate:", JSON.stringify(result));
    return result;
  }

  const results = [];

  results.push(await tryCandidate("baseline-no-op", async () => {}));

  results.push(await tryCandidate("webContents.invalidate", async () => {
    wc.invalidate();
  }));

  results.push(await tryCandidate("view.setVisible(false)-then-true", async () => {
    view.setVisible(false);
    await sleep(50);
    view.setVisible(true);
  }));

  // capturePage with an explicit (smaller) rect, bypassing the usual full-surface `capturePage(undefined, ...)`.
  {
    const g = await nextGen();
    await sleep(100);
    try {
      const image = await Promise.race([wc.capturePage({ x: 700, y: 400, width: 300, height: 300 }, { stayHidden: true }), sleep(5000).then(() => { throw new Error("timeout"); })]);
      const p = pixelAt(image, 0.5, 0.5);
      results.push({ name: "capturePage-explicit-rect-pixel-check", capture: { pixel: p?.rgb ?? null, expected: expectedColor(g), fresh: close(p?.rgb, expectedColor(g)) } });
    } catch (error) {
      results.push({ name: "capturePage-explicit-rect-pixel-check", capture: { error: String(error.message ?? error) } });
    }
  }

  results.push(await tryCandidate("setBackgroundThrottling-toggle-on-then-off", async () => {
    wc.setBackgroundThrottling(true);
    await sleep(50);
    wc.setBackgroundThrottling(false);
  }));

  results.push(await tryCandidate("host-setBackgroundThrottling-toggle", async () => {
    window.webContents.setBackgroundThrottling(true);
    await sleep(50);
    window.webContents.setBackgroundThrottling(false);
  }));

  results.push(await tryCandidate("setOpacity-nudge", async () => {
    // Nudges the window's compositor without changing visibility/minimized state (opacity has no visible
    // effect while minimized, but may or may not touch the compositor pipeline).
    const before = window.getOpacity ? window.getOpacity() : 1;
    window.setOpacity?.(Math.max(0, before - 0.001));
    await sleep(30);
    window.setOpacity?.(before);
  }));

  results.push(await tryCandidate("double-rAF-wait-before-capture", async () => {
    await wc.executeJavaScript("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  }));

  results.push(await tryCandidate("resize-view-bounds-nudge", async () => {
    const b = view.getBounds ? view.getBounds() : { x: 100, y: 50, width: 800, height: 600 };
    view.setBounds({ ...b, width: b.width - 1 });
    await sleep(30);
    view.setBounds(b);
  }));

  const report = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    release: os.release(),
    startedAt: new Date().toISOString(),
    windowStillMinimizedAtEnd: window.isMinimized(),
    results,
    anyFramePresented: results.some((r) => r.framePresented === true),
    anyFreshCapture: results.some((r) => r.capture?.fresh === true)
  };
  report.finishedAt = new Date().toISOString();

  server.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`probe written to ${OUT}`);
  console.log(`summary: anyFramePresented=${report.anyFramePresented} anyFreshCapture=${report.anyFreshCapture} windowStillMinimizedAtEnd=${report.windowStillMinimizedAtEnd}`);
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
