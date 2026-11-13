/**
 * Technical probe for Issue #42 (design 9): what still works on a WebContentsView while the host
 * BrowserWindow is minimized / unfocused? Raw Electron only (no controller), local fixture only.
 * No focus keeper and no re-focus helper runs during the background phases.
 *
 *   electron scripts/probe-minimized-browser.js [--soak-ms 60000] [--out test/artifacts/probe-minimized-browser.json]
 *
 * It records facts (it does not assert a verdict); verify-embedded-browser.js asserts the product behaviour.
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
const SOAK_MS = Number(argValue("--soak-ms", "60000"));
const OUT = path.resolve(root, argValue("--out", "test/artifacts/probe-minimized-browser.json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>probe</title>
<body style="margin:0;background:#fff">
<div id="mark" style="position:fixed;right:0;bottom:0;width:300px;height:300px;background:#000"></div>
<button id="b" style="position:fixed;left:20px;top:20px;width:140px;height:40px">go</button>
<input id="i" style="position:fixed;left:20px;top:80px;width:240px;height:28px">
<script>
window.__events = [];
for (const type of ["mousedown", "mouseup", "click", "keydown", "keyup", "input"]) {
  addEventListener(type, (e) => window.__events.push({ type, target: e.target && e.target.id, trusted: e.isTrusted, key: e.key, data: e.data }), true);
}
window.__ticks = 0; setInterval(() => { window.__ticks += 1; }, 50);
window.__raf = 0; (function f() { window.__raf += 1; requestAnimationFrame(f); })();
window.setGen = (n) => { document.getElementById("mark").style.background = "rgb(" + [(n * 37) % 256, (n * 91 + 40) % 256, (n * 53 + 100) % 256].join(",") + ")"; return n; };
window.genColor = (n) => [(n * 37) % 256, (n * 91 + 40) % 256, (n * 53 + 100) % 256];
</script>`;

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

const report = { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, release: os.release(), soakMs: SOAK_MS, startedAt: new Date().toISOString(), phases: {} };

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
const close = (a, b) => Boolean(a) && a.every((v, i) => Math.abs(v - b[i]) <= 6);

async function main() {
  const { server, base } = await startServer();
  const window = new BrowserWindow({ width: 1000, height: 700, show: true, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html;charset=utf-8,<body style='margin:0'><p>probe host</p></body>");
  const windowEvents = [];
  for (const name of ["minimize", "restore", "hide", "show", "focus", "blur"]) window.on(name, () => windowEvents.push({ name, t: Date.now() }));
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: "probe-minimized" } });
  window.contentView.addChildView(view);
  view.setBounds({ x: 100, y: 50, width: 800, height: 600 });
  view.setVisible(true);
  const wc = view.webContents;
  await wc.loadURL(`${base}/probe`);
  await sleep(500);
  const js = (code) => wc.executeJavaScript(code);
  const events = async () => JSON.parse(await js("JSON.stringify(window.__events)"));
  const clearEvents = () => js("window.__events.length = 0");
  const setGen = (n) => js(`window.setGen(${n})`);
  let gen = 100;
  const nextGen = async () => { gen += 1; await setGen(gen); return gen; };
  const expectedColor = (n) => [(n * 37) % 256, (n * 91 + 40) % 256, (n * 53 + 100) % 256];
  const dbg = wc.debugger;
  dbg.attach("1.3");
  const cdp = (method, params) => dbg.sendCommand(method, params);

  async function measureLiveness(label, ms) {
    const hostJs = (code) => window.webContents.executeJavaScript(code);
    const hostProbe = "(window.__hraf ??= (() => { window.__hn = 0; (function f() { window.__hn += 1; requestAnimationFrame(f); })(); return 1; })(), [window.__hn, document.visibilityState])";
    const t0 = await js("[window.__ticks, window.__raf, document.visibilityState, document.hasFocus()]");
    const h0 = await hostJs(hostProbe);
    await sleep(ms);
    const t1 = await js("[window.__ticks, window.__raf, document.visibilityState, document.hasFocus()]");
    const h1 = await hostJs(hostProbe);
    return { label, ms, ticksDelta: t1[0] - t0[0], rafDelta: t1[1] - t0[1], visibilityState: t1[2], documentHasFocus: t1[3], hostRafDelta: h1[0] - h0[0], hostVisibilityState: h1[1] };
  }

  /** Capture variants against a freshly set generation marker (bottom-right 300x300 block). */
  async function captureProbe() {
    const out = {};
    const variants = {
      capturePageDefault: () => wc.capturePage(),
      capturePageStayHidden: () => wc.capturePage(undefined, { stayHidden: true }),
      capturePageStayAwake: () => wc.capturePage(undefined, { stayAwake: true }),
      capturePageBoth: () => wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
    };
    for (const [name, fn] of Object.entries(variants)) {
      const g = await nextGen();
      await sleep(150);
      const started = Date.now();
      try {
        const image = await Promise.race([fn(), sleep(5000).then(() => { throw new Error("timeout 5s"); })]);
        const p = pixelAt(image, 0.97, 0.97);
        out[name] = { ms: Date.now() - started, size: p?.size ?? image.getSize(), pixel: p?.rgb ?? null, expected: expectedColor(g), fresh: close(p?.rgb, expectedColor(g)), empty: image.isEmpty() };
      } catch (error) {
        out[name] = { error: String(error.message ?? error) };
      }
    }
    {
      const g = await nextGen();
      await sleep(150);
      const started = Date.now();
      try {
        const shot = await Promise.race([cdp("Page.captureScreenshot", { format: "png" }), sleep(5000).then(() => { throw new Error("timeout 5s"); })]);
        const image = nativeImage.createFromBuffer(Buffer.from(shot.data, "base64"));
        const p = pixelAt(image, 0.97, 0.97);
        out.cdpCaptureScreenshot = { ms: Date.now() - started, size: p?.size, pixel: p?.rgb ?? null, expected: expectedColor(g), fresh: close(p?.rgb, expectedColor(g)) };
      } catch (error) {
        out.cdpCaptureScreenshot = { error: String(error.message ?? error) };
      }
    }
    return out;
  }

  /** Input variants. Coordinates are in view (page) space. */
  async function inputProbe() {
    const out = {};
    const clickTypes = (list, target) => list.filter((e) => e.target === target).map((e) => `${e.type}${e.trusted ? "" : "(untrusted)"}`).join(",");
    // native click
    await clearEvents();
    wc.sendInputEvent({ type: "mouseMove", x: 90, y: 40 });
    wc.sendInputEvent({ type: "mouseDown", x: 90, y: 40, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x: 90, y: 40, button: "left", clickCount: 1 });
    await sleep(250);
    out.nativeClick = clickTypes(await events(), "b");
    // CDP click
    await clearEvents();
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 90, y: 40 });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: 90, y: 40, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: 90, y: 40, button: "left", clickCount: 1 });
    await sleep(250);
    out.cdpClick = clickTypes(await events(), "b");
    // native insertText into the input (focus the input DOM-side first)
    await js("document.getElementById('i').value=''; document.getElementById('i').focus(); 0");
    await clearEvents();
    let nativeInsert = null;
    try {
      await wc.insertText("こんにちは");
      nativeInsert = await js("document.getElementById('i').value");
    } catch (error) {
      nativeInsert = `error:${error.message}`;
    }
    out.nativeInsertText = nativeInsert;
    // CDP insertText
    await js("document.getElementById('i').value=''; document.getElementById('i').focus(); 0");
    await cdp("Input.insertText", { text: "日本語\n改行" });
    out.cdpInsertText = await js("document.getElementById('i').value");
    // native key: Tab then press (keydown trusted?)
    await js("document.getElementById('i').focus(); 0");
    await clearEvents();
    wc.sendInputEvent({ type: "keyDown", keyCode: "Delete" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Delete" });
    await sleep(200);
    out.nativeKey = (await events()).filter((e) => e.type.startsWith("key")).map((e) => `${e.type}:${e.key}${e.trusted ? "" : "(untrusted)"}`).join(",");
    // CDP key
    await js("document.getElementById('i').focus(); 0");
    await clearEvents();
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(200);
    out.cdpKey = (await events()).filter((e) => e.type.startsWith("key")).map((e) => `${e.type}:${e.key}${e.trusted ? "" : "(untrusted)"}`).join(",");
    out.cdpKeyFocusMovedAway = (await js("document.activeElement.id")) !== "i";
    // CDP modifier: Shift+A via key event with modifiers
    await js("document.getElementById('i').value=''; document.getElementById('i').focus(); 0");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "A", code: "KeyA", text: "A", modifiers: 8, windowsVirtualKeyCode: 65 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "A", code: "KeyA", modifiers: 8, windowsVirtualKeyCode: 65 });
    out.cdpShiftA = await js("document.getElementById('i').value");
    return out;
  }

  async function phase(name, setup) {
    if (setup) await setup();
    const data = { window: { minimized: window.isMinimized(), visible: window.isVisible(), focused: window.isFocused() }, view: { visibleAttr: view.getVisible?.() ?? null } };
    data.liveness = await measureLiveness("short", 1500);
    data.capture = await captureProbe();
    data.input = await inputProbe();
    data.domState = await js("[document.visibilityState, document.hasFocus()]");
    report.phases[name] = data;
    console.log(`phase ${name}:`, JSON.stringify({ window: data.window, live: data.liveness, click: data.input.nativeClick + " | " + data.input.cdpClick, cap: Object.fromEntries(Object.entries(data.capture).map(([k, v]) => [k, v.fresh ?? v.error])) }));
  }

  await phase("A-visible-baseline");

  // B: minimized, default throttling
  const minimizeNow = async () => {
    const minimized = new Promise((resolve) => window.once("minimize", resolve));
    window.minimize();
    await Promise.race([minimized, sleep(3000)]);
    for (let i = 0; i < 30 && !window.isMinimized(); i += 1) await sleep(100);
    await sleep(800);
  };
  await phase("B-minimized-default-throttling", minimizeNow);
  report.phases["B-minimized-default-throttling"].soak = await measureLiveness("soak", SOAK_MS);
  console.log("B soak:", JSON.stringify(report.phases["B-minimized-default-throttling"].soak));
  const afterSoak = {};
  afterSoak.capture = await captureProbe();
  afterSoak.input = await inputProbe();
  report.phases["B-minimized-default-throttling"].afterSoak = afterSoak;

  // C: restore, then minimize again with throttling disabled on both the page and the host renderer
  const restoreNow = async () => {
    window.restore();
    for (let i = 0; i < 30 && window.isMinimized(); i += 1) await sleep(100);
    await sleep(800);
  };
  await restoreNow();
  wc.setBackgroundThrottling(false);
  window.webContents.setBackgroundThrottling(false);
  await phase("C-minimized-throttling-off", minimizeNow);
  report.phases["C-minimized-throttling-off"].soak = await measureLiveness("soak", SOAK_MS);
  console.log("C soak:", JSON.stringify(report.phases["C-minimized-throttling-off"].soak));
  const afterSoakC = {};
  afterSoakC.capture = await captureProbe();
  afterSoakC.input = await inputProbe();
  report.phases["C-minimized-throttling-off"].afterSoak = afterSoakC;

  // D: restored, window shown but not focused (blur) -- another window (a second BrowserWindow) takes focus
  await restoreNow();
  const other = new BrowserWindow({ width: 400, height: 300, x: 1200, y: 100, show: true });
  await other.loadURL("data:text/html,<body>other</body>");
  other.focus();
  await sleep(800);
  await phase("D-visible-unfocused", async () => { await sleep(300); });
  report.phases["D-visible-unfocused"].focusAtEnd = { host: window.isFocused(), other: other.isFocused() };

  // E: fully covered by another window of the same size on top
  other.setBounds(window.getBounds());
  other.focus();
  await sleep(1000);
  await phase("E-fully-covered", async () => { await sleep(300); });
  report.phases["E-fully-covered"].focusAtEnd = { host: window.isFocused(), other: other.isFocused() };
  other.close();

  // F: iterate minimize/restore with input landing + capture freshness
  await restoreNow();
  const loops = [];
  for (let i = 0; i < 20; i += 1) {
    await minimizeNow();
    const g = await nextGen();
    await sleep(120);
    await clearEvents();
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: 90, y: 40, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: 90, y: 40, button: "left", clickCount: 1 });
    await sleep(120);
    const clicked = (await events()).filter((e) => e.target === "b" && e.type === "click" && e.trusted).length;
    let fresh = false;
    try {
      const image = await wc.capturePage(undefined, { stayHidden: true });
      fresh = close(pixelAt(image, 0.97, 0.97)?.rgb, expectedColor(g));
    } catch { /* recorded as not fresh */ }
    // Same, but wait for two page frames after the change before capturing (frame settle).
    const g2 = await nextGen();
    let freshAfterFrames = false;
    try {
      await js("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const image = await wc.capturePage(undefined, { stayHidden: true });
      freshAfterFrames = close(pixelAt(image, 0.97, 0.97)?.rgb, expectedColor(g2));
    } catch { /* recorded as not fresh */ }
    const minimizedDuring = window.isMinimized();
    await restoreNow();
    loops.push({ i, minimizedDuring, clicked, fresh, freshAfterFrames });
  }
  report.phases["F-loop20"] = { loops, allClicked: loops.every((l) => l.clicked === 1), allFresh: loops.every((l) => l.fresh), allFreshAfterFrames: loops.every((l) => l.freshAfterFrames), allMinimized: loops.every((l) => l.minimizedDuring) };
  console.log("F loop:", JSON.stringify({ allClicked: report.phases["F-loop20"].allClicked, allFresh: report.phases["F-loop20"].allFresh, allFreshAfterFrames: report.phases["F-loop20"].allFreshAfterFrames, allMinimized: report.phases["F-loop20"].allMinimized }));

  // G: a view CREATED and attached while the window is already minimized (first acquire / autoOpen while minimized)
  await minimizeNow();
  {
    const view2 = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: "probe-minimized-g" } });
    window.contentView.addChildView(view2);
    view2.setBounds({ x: 100, y: 50, width: 800, height: 600 });
    view2.setVisible(true);
    const wc2 = view2.webContents;
    wc2.setBackgroundThrottling(false);
    await wc2.loadURL(`${base}/probe`);
    await sleep(800);
    const js2 = (code) => wc2.executeJavaScript(code);
    const dbg2 = wc2.debugger;
    dbg2.attach("1.3");
    const g = {};
    const a0 = await js2("[window.__ticks, window.__raf, document.visibilityState]");
    await sleep(1500);
    const a1 = await js2("[window.__ticks, window.__raf, document.visibilityState]");
    g.liveness = { ticksDelta: a1[0] - a0[0], rafDelta: a1[1] - a0[1], visibilityState: a1[2] };
    g.capture = {};
    const variant = async (name, fn) => {
      await js2("window.setGen(200)");
      await sleep(200);
      try {
        const image = await Promise.race([fn(), sleep(5000).then(() => { throw new Error("timeout 5s"); })]);
        const p = pixelAt(image, 0.97, 0.97);
        g.capture[name] = { pixel: p?.rgb, expected: expectedColor(200), fresh: close(p?.rgb, expectedColor(200)) };
      } catch (error) { g.capture[name] = { error: String(error.message ?? error) }; }
    };
    await variant("capturePageDefault", () => wc2.capturePage());
    await variant("capturePageStayHidden", () => wc2.capturePage(undefined, { stayHidden: true }));
    await variant("capturePageStayHiddenStayAwake", () => wc2.capturePage(undefined, { stayHidden: true, stayAwake: true }));
    await variant("cdpCaptureScreenshot", async () => nativeImage.createFromBuffer(Buffer.from((await dbg2.sendCommand("Page.captureScreenshot", { format: "png" })).data, "base64")));
    await js2("window.__events.length = 0");
    wc2.sendInputEvent({ type: "mouseDown", x: 90, y: 40, button: "left", clickCount: 1 });
    wc2.sendInputEvent({ type: "mouseUp", x: 90, y: 40, button: "left", clickCount: 1 });
    await sleep(250);
    g.nativeClickTrusted = (await js2("JSON.stringify(window.__events)")).includes('"trusted":true');
    report.phases["G-view-created-while-minimized"] = g;
    console.log("phase G:", JSON.stringify(g));
    try { dbg2.detach(); } catch { /* ignore */ }
  }
  await restoreNow();

  report.windowEvents = windowEvents.map((e) => e.name);
  report.finishedAt = new Date().toISOString();
  try { dbg.detach(); } catch { /* already detached */ }
  server.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`probe written to ${OUT}`);
  exitNow(0);
}

function exitNow(code) {
  try { process.reallyExit(code); } catch { app.exit(code); }
}

app.whenReady().then(main).catch((error) => { console.error(error); app.exit(2); });
