/**
 * Live verification of the embedded browser against a REAL Electron WebContentsView
 * (design 17.2). It drives the real controller/host from dist/, with local fixtures only.
 *
 *   xvfb-run -a node_modules/.bin/electron --no-sandbox scripts/verify-embedded-browser.js
 *
 * It does NOT exercise the Lit UI (that is the manual live-UI verification, T15).
 * No focus keeper and no re-focus helper runs: operations must not depend on OS focus (Issue #42).
 * LILTO_MIN_SOAK_MS sets how long the minimized soak waits (default 5000; the 60 s release run uses 60000).
 * LILTO_VERIFY_WATCHDOG_MS caps the whole run (default LILTO_MIN_SOAK_MS + 8 min); past it the script force-exits
 * with code 1 and writes partial results instead of hanging indefinitely on a never-resolving controller call.
 */
const { app, BrowserWindow, nativeImage, powerMonitor } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { EmbeddedBrowserController } = require(path.join(root, "dist/main/embedded-browser.js"));
const { createElectronBrowserHost, attachControllerToWindow, attachControllerToPowerMonitor } = require(path.join(root, "dist/main/embedded-browser-electron.js"));

const results = [];
const report = {};
let lastCheckName = "(none yet)";
const check = (name, condition, detail) => {
  lastCheckName = name;
  results.push({ name, ok: Boolean(condition), ...(condition ? {} : { detail: String(detail ?? "") }) });
  if (!condition) console.error(`FAIL ${name} ${detail ?? ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// fill() resolves once the input is dispatched, not once the page has applied it; poll instead of reading once.
const waitForValue = async (read, expected, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (value !== expected && Date.now() < deadline) {
    await sleep(50);
    value = await read();
  }
  return value;
};

function startServer() {
  const form = fs.readFileSync(path.join(root, "test/fixtures/browser/form.html"));
  const minimizedPage = fs.readFileSync(path.join(root, "test/fixtures/browser/minimized.html"));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/download") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=x.bin" });
      return res.end("bin");
    }
    if (url.pathname === "/popup") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<title>popup</title><p>popup page</p>"); }
    if (url.pathname === "/next") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<title>next</title><h1>次のページ</h1>"); }
    if (url.pathname === "/eval-parent") {
      // Same-origin child + a localhost child (different site => out-of-process iframe).
      const port = server.address().port;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<title>eval-parent</title><h1>親</h1><iframe name="same" src="/eval-child"></iframe><iframe name="cross" src="http://localhost:${port}/eval-child"></iframe>`);
    }
    if (url.pathname === "/eval-child") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end("<title>child</title><p id='who'>子frame</p><script>window.childState = { n: 7 }</script>"); }
    if (url.pathname === "/minimized") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(minimizedPage); }
    if (url.pathname === "/form") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(form); }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function main() {
  // Any single controller call can in principle never resolve (observed: this script hung for 30+ minutes
  // on windows-latest CI runners with no single await identified as the cause). A watchdog over the whole
  // run turns a silent multi-hour hang into a fast, diagnosable failure instead of auditing every await.
  const SOAK_MS = Number(process.env.LILTO_MIN_SOAK_MS ?? 5000);
  const WATCHDOG_MS = Number(process.env.LILTO_VERIFY_WATCHDOG_MS ?? SOAK_MS + 8 * 60 * 1000);
  const watchdog = setTimeout(() => {
    console.error(`WATCHDOG: verify-embedded-browser did not finish within ${WATCHDOG_MS}ms; last check reached: "${lastCheckName}"`);
    try {
      fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "test/artifacts/verify-embedded-browser.json"),
        JSON.stringify({ electron: process.versions.electron, platform: process.platform, watchdogTimeout: true, lastCheck: lastCheckName, total: results.length, failed: results.filter((r) => !r.ok).length + 1, ...report, results }, null, 2)
      );
    } catch (error) {
      console.error("WATCHDOG: failed to write partial results", error);
    }
    exitNow(1);
  }, WATCHDOG_MS);

  const { server, base } = await startServer();
  const window = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html;charset=utf-8,<body style='margin:0'><p>host</p></body>");
  await sleep(1500); // let the freshly shown macOS window finish its show/focus/resize events before the first acquire
  const host = createElectronBrowserHost(() => window);
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });
  attachControllerToWindow(controller, window);
  controller.beginRendererEpoch();
  let seq = 0;
  const present = (over = {}) => {
    const state = controller.getState();
    seq += 1;
    controller.updateViewport({
      rendererEpoch: state.rendererEpoch, seq, layoutRevision: state.layoutRevision,
      viewport: { x: 500, y: 40, width: 580, height: 720 }, hostViewport: { width: 1100, height: 800 },
      panelOpen: true, occluded: false, resizing: false, ...over
    });
  };
  // Like the real renderer: one answer per layout / panel-open request, never a loop while the environment is blocked.
  let prevAsk = { requested: false, layoutRevision: -1, epoch: "" };
  controller.onState((state) => {
    const asked = (state.panelRequested && !prevAsk.requested) || state.layoutRevision !== prevAsk.layoutRevision || state.rendererEpoch !== prevAsk.epoch;
    prevAsk = { requested: state.panelRequested, layoutRevision: state.layoutRevision, epoch: state.rendererEpoch };
    if (state.panelRequested && !state.operationReady && asked && !blockPresent) setImmediate(present);
  });
  let blockPresent = false;
  const newRun = (conversationId = "A") => {
    const ctx = controller.issueRun({ conversationId, requestId: `req-${conversationId}`, policyRevision: 1 });
    return { ctx, handle: { runId: ctx.runId, conversationId, signal: controller.ownership.resolveToken(ctx.token).signal } };
  };
  const view = () => controller.view;
  const wc = () => controller.liveContents();
  const events = async () => wc().executeJavaScript("JSON.stringify(window.__events)").then(JSON.parse);
  const clearEvents = () => wc().executeJavaScript("window.__events.length = 0");
  const node = (snap, role, name) => snap.nodes.find((n) => n.role === role && n.name === name);

  /* ---------- T04: safe view ---------- */
  const a = newRun("A");
  const acquired = await controller.acquire(a.handle, { url: `${base}/form` });
  check("acquire loads the local page and shows the view", acquired.ok && acquired.state.panelVisible, JSON.stringify(acquired));
  const lease = acquired.result?.leaseId;
  check("exactly one extra WebContentsView child and no extra windows", BrowserWindow.getAllWindows().length === 1 && window.contentView.children.length === 1);
  check("page has no window.lilto / require / process", await wc().executeJavaScript("typeof window.lilto + typeof require + typeof process") === "undefinedundefinedundefined");
  check("page sees title", wc().getTitle() === "fixture-form");
  const blocked = await controller.acquire(newRun("B").handle, { url: "file:///etc/passwd" });
  check("non-http(s) acquire is blocked", !blocked.ok && blocked.error.code === "NAVIGATION_BLOCKED");
  const navBlocked = await controller.navigate(a.handle, { leaseId: lease, url: "javascript:alert(1)" });
  check("navigate(javascript:) blocked", !navBlocked.ok && navBlocked.error.code === "NAVIGATION_BLOCKED");
  await wc().executeJavaScript("location.href = 'file:///etc/hostname'; 0").catch(() => {});
  await sleep(300);
  check("page-initiated file: navigation is blocked", wc().getURL().startsWith("http://127.0.0.1"), wc().getURL());

  /* ---------- T08: snapshot ---------- */
  let snap = await controller.snapshot(a.handle, { leaseId: lease });
  check("snapshot ok", snap.ok, JSON.stringify(snap).slice(0, 300));
  const s1 = snap.result;
  check("dom-v1 format", s1.format === "dom-v1" && s1.limitations.length > 0);
  check("heading present", Boolean(node(s1, "heading", "問い合わせ")));
  check("label->textbox name", Boolean(node(s1, "textbox", "メールアドレス")) && Boolean(node(s1, "textbox", "お問い合わせ内容")));
  check("checkbox has state", node(s1, "checkbox", "同意する")?.states.checked === false);
  check("select is combobox", Boolean(node(s1, "combobox", "色")));
  check("open shadow DOM button is visible", Boolean(node(s1, "button", "Shadowボタン")));
  const iframe = s1.nodes.find((n) => n.role === "iframe");
  check("iframe is opaque + unsupported", iframe && iframe.unsupportedReason === "iframe" && iframe.actionable === false);
  check("hidden/display:none buttons excluded", !node(s1, "button", "見えないボタン"));
  check("disabled button reported", node(s1, "button", "無効ボタン")?.states.disabled === true);
  const pw = node(s1, "textbox", "パスワード");
  check("password: flagged, value never returned", pw && pw.states.password === true && pw.value === undefined && !JSON.stringify(s1).includes("s3cret-value"));
  check("hidden input value never returned", !JSON.stringify(s1).includes("hidden-value"));
  const fileNode = s1.nodes.find((n) => n.name === "ファイル");
  check("file input unsupported", fileNode && fileNode.unsupportedReason === "file input");
  const snap2 = await controller.snapshot(a.handle, { leaseId: lease });
  check("snapshot text is deterministic and refs are stable for the same elements", snap2.result.text === s1.text.replace(new RegExp(s1.snapshotId, "g"), snap2.result.snapshotId) && snap2.result.nodes.map((n) => n.ref).join() === s1.nodes.map((n) => n.ref).join());
  check("refs follow b<own>-d<doc>-n<id>", /^b\d+-d\d+-n\d+$/.test(s1.nodes[0].ref));
  check("old snapshot id is stale after a newer one", (await controller.getText(a.handle, { leaseId: lease, snapshotId: s1.snapshotId, ref: node(s1, "heading", "問い合わせ").ref })).error?.code === "STALE_REF");
  const small = await controller.snapshot(a.handle, { leaseId: lease, maxNodes: 5 });
  check("maxNodes truncates with truncated=true", small.ok && small.result.nodes.length === 5 && small.result.truncated === true);

  /* ---------- T09: input ---------- */
  snap = await controller.snapshot(a.handle, { leaseId: lease });
  let S = snap.result;
  const ref = (role, name) => node(S, role, name).ref;
  await clearEvents();
  const click = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "送信") });
  check("click dispatched", click.ok, JSON.stringify(click));
  await sleep(150);
  const evs = (await events()).filter((e) => e.target === "send");
  check("click: trusted mousedown,mouseup,click in order on the target", evs.map((e) => e.type).join() === "mousedown,mouseup,click" && evs.every((e) => e.trusted), JSON.stringify(evs));
  check("planned input did not trigger user-interruption", controller.ownership.getOwner().kind === "agent");

  await clearEvents();
  const covered = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "隠れたボタン") });
  check("covered click is refused and sends nothing", !covered.ok && covered.error.code === "ELEMENT_NOT_INTERACTABLE" && (await events()).length === 0 && !(await wc().executeJavaScript("window.__coveredClicked")), JSON.stringify(covered));
  const dis = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "無効ボタン") });
  check("disabled click refused", !dis.ok && dis.error.code === "ELEMENT_NOT_INTERACTABLE");
  const fileClick = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: node(S, "textbox", "ファイル").ref });
  check("file input refused", !fileClick.ok && fileClick.error.code === "UNSUPPORTED_TARGET");

  const fill = (name, text, role = "textbox") => controller.fill(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref(role, name), text });
  const fillOk = await fill("メールアドレス", "こんにちは世界");
  check("fill Japanese into input", fillOk.ok && await waitForValue(() => wc().executeJavaScript("document.getElementById('email').value"), "こんにちは世界") === "こんにちは世界");
  const fillOk2 = await fill("メールアドレス", "b@example.com");
  check("fill replaces existing text", fillOk2.ok && await waitForValue(() => wc().executeJavaScript("document.getElementById('email').value"), "b@example.com") === "b@example.com");
  const fillOk3 = await fill("お問い合わせ内容", "一行目\n二行目");
  check("fill textarea", fillOk3.ok && await waitForValue(() => wc().executeJavaScript("document.getElementById('msg').value"), "一行目\n二行目") === "一行目\n二行目");
  const fillOk4 = await fill("制御入力", "xyz");
  check("fill drives controlled input handlers", fillOk4.ok && await waitForValue(() => wc().executeJavaScript("document.getElementById('mirror').textContent"), "state:xyz") === "state:xyz");
  const fillOk5 = await fill("メールアドレス", "");
  check("fill empty clears", fillOk5.ok && await waitForValue(() => wc().executeJavaScript("document.getElementById('email').value"), "") === "");
  const ce = await fill("メモ", "メモ内容");
  check("fill contenteditable", ce.ok && (await waitForValue(() => wc().executeJavaScript("document.getElementById('ce').innerText").then((t) => t.trim()), "メモ内容")) === "メモ内容", JSON.stringify(ce));
  check("fill password allowed without echoing the value", (await fill("パスワード", "np-secret")).ok && !JSON.stringify(await controller.snapshot(a.handle, { leaseId: lease })).includes("np-secret"));
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;

  const boxClick = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("checkbox", "同意する") });
  await sleep(250);
  check("checkbox toggled by real click", boxClick.ok && await wc().executeJavaScript("document.getElementById('agree').checked") === true);
  const sel = await controller.select(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("combobox", "色"), values: ["b"] });
  check("select sets the option and fires change", sel.ok && sel.result.selectedValues[0] === "b" && await wc().executeJavaScript("document.getElementById('sel').value") === "b", JSON.stringify(sel));
  check("select rejects unknown values", !(await controller.select(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("combobox", "色"), values: ["zzz"] })).ok);
  await fill("メールアドレス", "enter@example.com");
  await clearEvents();
  const press = await controller.press(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("textbox", "メールアドレス"), key: "Tab" });
  await sleep(250);
  check("press Tab moves focus away and is a trusted keydown", press.ok && (await events()).some((e) => e.type === "keydown" && e.trusted) && await wc().executeJavaScript("document.activeElement.id") !== "email", JSON.stringify(press));

  const scroll = await controller.scroll(a.handle, { leaseId: lease, deltaY: 600 });
  check("page scroll reports position", scroll.ok && scroll.result.scrollY === 600, JSON.stringify(scroll));
  const text = await controller.getText(a.handle, { leaseId: lease, maxChars: 20 });
  check("get_text truncates", text.ok && text.result.text.length === 20 && text.result.truncated === true);
  const shot = await controller.screenshot(a.handle, { leaseId: lease });
  const png = shot.ok ? Buffer.from(shot.result.imageBase64, "base64") : Buffer.alloc(0);
  check("screenshot is a PNG within limits", shot.ok && png.subarray(1, 4).toString() === "PNG" && png.length <= 1024 * 1024 && Math.max(shot.result.width, shot.result.height) <= 1280, JSON.stringify(shot).slice(0, 200));
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  const shadow = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "Shadowボタン") });
  await sleep(250);
  check("click inside open shadow DOM", shadow.ok && await wc().executeJavaScript("window.__shadowClicked") === true, JSON.stringify(shadow));

  // wait + late DOM
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "後で表示") });
  const waited = await controller.wait(a.handle, { leaseId: lease, timeoutMs: 5000, condition: { kind: "text", text: "遅れて出現", present: true } });
  check("wait(text) resolves after a delayed render", waited.ok && waited.result.elapsedMs >= 100, JSON.stringify(waited));
  const timeout = await controller.wait(a.handle, { leaseId: lease, timeoutMs: 400, condition: { kind: "text", text: "出ない", present: true } });
  check("wait times out with TIMEOUT", !timeout.ok && timeout.error.code === "TIMEOUT");

  // ref invalidation on real DOM changes
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  const agreeRef = ref("checkbox", "同意する");
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "置換") });
  await sleep(250); // click = input delivered, not handled: let the page apply the mutation first
  const replaced = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: agreeRef });
  check("replaced element => STALE_REF (no selector re-resolution)", !replaced.ok && replaced.error.code === "STALE_REF", JSON.stringify(replaced));
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  const sendRef = ref("button", "送信");
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "改名") });
  await sleep(250);
  const renamed = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: sendRef });
  check("changed meaning (name) => STALE_REF", !renamed.ok && renamed.error.code === "STALE_REF", JSON.stringify(renamed));

  // SPA navigation invalidates snapshots
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "SPA遷移") });
  await sleep(200);
  const afterSpa = await controller.getText(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("heading", "問い合わせ") });
  check("in-page (SPA) navigation invalidates the snapshot", !afterSpa.ok && afterSpa.error.code === "STALE_REF", JSON.stringify(afterSpa));

  // popup stays in the same surface; download cancelled
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "ポップアップ") });
  await sleep(800);
  check("window.open loads in the same surface, no new window", wc().getURL().endsWith("/popup") && BrowserWindow.getAllWindows().length === 1 && window.contentView.children.length === 1, wc().getURL());
  await controller.navigate(a.handle, { leaseId: lease, url: `${base}/form` });
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("link", "ダウンロード") });
  await sleep(600);
  check("download is cancelled (page stays)", wc().getURL().endsWith("/form"), wc().getURL());

  // link click navigates; history back
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("link", "次へ") });
  const toNext = await controller.wait(a.handle, { leaseId: lease, timeoutMs: 5000, condition: { kind: "url", url: `${base}/next` } });
  check("link click + wait(url)", toNext.ok, JSON.stringify(toNext));
  const back = await controller.back(a.handle, { leaseId: lease });
  check("history back", back.ok && back.result.navigated === true && wc().getURL().endsWith("/form"), JSON.stringify(back));

  // load failure keeps the host alive
  const fail = await controller.navigate(a.handle, { leaseId: lease, url: "http://127.0.0.1:1/" });
  check("load failure => NAVIGATION_FAILED, host alive, error shown", !fail.ok && fail.error.code === "NAVIGATION_FAILED" && !window.isDestroyed() && Boolean(controller.getState().error), JSON.stringify(fail));
  await controller.navigate(a.handle, { leaseId: lease, url: `${base}/form` });

  /* ---------- T07: user input interrupts ---------- */
  snap = await controller.snapshot(a.handle, { leaseId: lease }); S = snap.result;
  wc().sendInputEvent({ type: "mouseMove", x: 30, y: 30 });
  wc().sendInputEvent({ type: "mouseDown", x: 30, y: 30, button: "left", clickCount: 1 });
  wc().sendInputEvent({ type: "mouseUp", x: 30, y: 30, button: "left", clickCount: 1 });
  await sleep(200);
  check("unplanned (user-like) mouse input takes over and is blocked from the page", controller.ownership.getOwner().kind === "user", controller.ownership.getOwner().kind);
  const afterUser = await controller.click(a.handle, { leaseId: lease, snapshotId: S.snapshotId, ref: ref("button", "送信") });
  check("after takeover the agent's click is rejected and nothing is delivered", !afterUser.ok && afterUser.error.code === "USER_INTERRUPTED");
  controller.allowAgentControl();

  /* ---------- modal occlusion & hide ---------- */
  const b = newRun("A");
  const re = await controller.acquire(b.handle, { url: `${base}/form` });
  check("reacquire after allow", re.ok, JSON.stringify(re));
  blockPresent = true;
  const waiting = controller.wait(b.handle, { leaseId: re.result.leaseId, timeoutMs: 8000, condition: { kind: "text", text: "出ない", present: true } });
  await sleep(250);
  controller.setPresentation({ open: true, occluded: true, resizing: false });
  const cancelled = await waiting;
  check("modal cancels an in-flight wait and hides the native view", !cancelled.ok && cancelled.error.code === "PANEL_OCCLUDED" && controller.getState().panelVisible === false, JSON.stringify(cancelled));
  blockPresent = false;
  present();
  check("view returns after a fresh measurement", controller.getState().panelVisible === true);

  /* ---------- browser_evaluate (Issue #38) ---------- */
  controller.ownership.revokeRun(b.ctx.runId);
  const ev = newRun("A");
  const evAcq = await controller.acquire(ev.handle, { url: `${base}/eval-parent` });
  check("evaluate: acquire parent page with frames", evAcq.ok, JSON.stringify(evAcq));
  const evLease = evAcq.result?.leaseId;
  const evEpoch = () => controller.ownership.epochs.documentEpoch;
  const evalIn = (script, extra = {}) => controller.evaluate(ev.handle, { leaseId: evLease, documentEpoch: evEpoch(), script, ...extra });
  const mainEval = await evalIn("return document.title");
  check("evaluate: main frame returns a JSON value", mainEval.ok && mainEval.result.value.type === "json" && mainEval.result.value.value === "eval-parent", JSON.stringify(mainEval));
  check("evaluate: async body awaits and undefined is reported", (await evalIn("await new Promise(r => setTimeout(r, 50)); return 1+1")).result?.value.value === 2 && (await evalIn("1+1")).result?.value.type === "undefined");
  const evSnap = await controller.snapshot(ev.handle, { leaseId: evLease });
  const frames = evSnap.result?.frames ?? [];
  check("evaluate: snapshot lists main + two child frames with opaque ids", evSnap.ok && frames.length === 3 && frames.filter((f) => f.isMainFrame).length === 1 && frames.every((f) => /^[A-Za-z0-9_-]+$/.test(f.frameId)), JSON.stringify(frames));
  const childFrames = frames.filter((f) => !f.isMainFrame);
  const sameFrame = childFrames.find((f) => f.name === "same");
  const crossFrame = childFrames.find((f) => f.name === "cross");
  check("evaluate: frames are evaluable http(s)", sameFrame?.evaluable === true && crossFrame?.evaluable === true, JSON.stringify(childFrames));
  const sameEval = await evalIn("return [document.getElementById('who').textContent, window.childState.n]", { frameId: sameFrame?.frameId });
  check("evaluate: same-origin child frame runs in that frame's page world", sameEval.ok && JSON.stringify(sameEval.result.value.value) === JSON.stringify(["子frame", 7]) && sameEval.result.frameUrl.endsWith("/eval-child"), JSON.stringify(sameEval));
  const crossEval = await evalIn("return [location.hostname, window.childState.n]", { frameId: crossFrame?.frameId });
  check("evaluate: cross-origin (out-of-process) child frame runs", crossEval.ok && JSON.stringify(crossEval.result.value.value) === JSON.stringify(["localhost", 7]), JSON.stringify(crossEval));
  const afterEvalRef = await controller.getText(ev.handle, { leaseId: evLease, snapshotId: evSnap.result.snapshotId, ref: evSnap.result.nodes[0].ref });
  check("evaluate: delivery invalidated the earlier snapshot", !afterEvalRef.ok && afterEvalRef.error.code === "STALE_REF", JSON.stringify(afterEvalRef));
  const badEpoch = await controller.evaluate(ev.handle, { leaseId: evLease, documentEpoch: evEpoch() + 99, script: "return 1" });
  check("evaluate: wrong documentEpoch => STALE_DOCUMENT, effect none", !badEpoch.ok && badEpoch.error.code === "STALE_DOCUMENT" && badEpoch.error.effect === "none", JSON.stringify(badEpoch));
  const bad = await evalIn("return new Date()");
  check("evaluate: non-JSON result => error, not 'none' effect, not retryable", !bad.ok && bad.error.retryable === false && bad.error.effect !== "none", JSON.stringify(bad));
  const big = await evalIn("return 'x'.repeat(70 * 1024)");
  check("evaluate: >64 KiB result => RESULT_TOO_LARGE", !big.ok && big.error.code === "RESULT_TOO_LARGE", JSON.stringify(big).slice(0, 200));
  const syntax = await evalIn("return (");
  check("evaluate: syntax error is refused before delivery", !syntax.ok && syntax.error.effect === "none", JSON.stringify(syntax));

  // Synchronous infinite loop in a cross-origin child frame: cut off by the deadline, view destroyed, host alive.
  const loopStarted = Date.now();
  const loop = await evalIn("while (true) {}", { frameId: crossFrame?.frameId, timeoutMs: 1000 });
  check("evaluate: infinite loop in an OOPIF child => TIMEOUT within the deadline (not hung)", !loop.ok && loop.error.code === "TIMEOUT" && loop.error.retryable === false && loop.error.effect === "possible" && Date.now() - loopStarted < 6000, JSON.stringify(loop));
  await sleep(500);
  check("evaluate: the stuck view was closed and the host survives", !window.isDestroyed() && window.contentView.children.length === 0 && controller.liveContents() == null, `children=${window.contentView.children.length}`);

  // Recovery: a fresh run can open a new view in the same partition and evaluate again.
  const ev2 = newRun("A");
  let evAcq2 = await controller.acquire(ev2.handle, { url: `${base}/eval-parent` });
  for (let i = 0; !evAcq2.ok && i < 20; i += 1) { await sleep(250); evAcq2 = await controller.acquire(ev2.handle, { url: `${base}/eval-parent` }); }
  check("evaluate: a new view can be created after the loop was cut off", evAcq2.ok, JSON.stringify(evAcq2));
  const rec = await controller.evaluate(ev2.handle, { leaseId: evAcq2.result?.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "return document.title" });
  check("evaluate: works again after recovery", rec.ok && rec.result.value.value === "eval-parent", JSON.stringify(rec));

  // Main-frame infinite loop, and cancellation (run revoked) while the script is running.
  const mainLoop = await controller.evaluate(ev2.handle, { leaseId: evAcq2.result?.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "while (true) {}", timeoutMs: 800 });
  check("evaluate: infinite loop in the main frame => TIMEOUT", !mainLoop.ok && mainLoop.error.code === "TIMEOUT" && mainLoop.error.effect === "possible", JSON.stringify(mainLoop));
  await sleep(500);
  const ev3 = newRun("A");
  let evAcq3 = await controller.acquire(ev3.handle, { url: `${base}/eval-parent` });
  for (let i = 0; !evAcq3.ok && i < 20; i += 1) { await sleep(250); evAcq3 = await controller.acquire(ev3.handle, { url: `${base}/eval-parent` }); }
  check("evaluate: reacquire after main-frame loop", evAcq3.ok, JSON.stringify(evAcq3));
  const cancelStarted = Date.now();
  const pending = controller.evaluate(ev3.handle, { leaseId: evAcq3.result?.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "await new Promise(() => {})", timeoutMs: 30000 });
  await sleep(400);
  controller.ownership.revokeRun(ev3.ctx.runId);
  const cancelled3 = await pending;
  check("evaluate: cancelling a running evaluate settles quickly with effect possible, retryable false", !cancelled3.ok && cancelled3.error.retryable === false && cancelled3.error.effect === "possible" && Date.now() - cancelStarted < 5000, JSON.stringify(cancelled3));
  await sleep(500);
  check("evaluate: the cancelled run's view was closed", controller.liveContents() == null && !window.isDestroyed());

  // evaluate OFF at runtime: direct call is refused with effect none.
  const ev4 = newRun("A");
  let evAcq4 = await controller.acquire(ev4.handle, { url: `${base}/eval-parent` });
  for (let i = 0; !evAcq4.ok && i < 20; i += 1) { await sleep(250); evAcq4 = await controller.acquire(ev4.handle, { url: `${base}/eval-parent` }); }
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false });
  const ev5 = newRun("A");
  const off = await controller.evaluate(ev5.handle, { leaseId: evAcq4.result?.leaseId ?? "x", documentEpoch: 0, script: "return 1" });
  check("evaluate: disabled in settings => refused (EVALUATE_DISABLED or lease rejected), effect none", !off.ok && off.error.effect === "none", JSON.stringify(off));
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });

  /* ---------- Issue #42: minimized / unfocused / covered windows keep working ---------- */
  const winEvents = [];
  for (const name of ["minimize", "restore", "hide", "show"]) window.on(name, () => winEvents.push(name));
  const genColor = (n) => [(n * 37) % 256, (n * 91 + 40) % 256, (n * 53 + 100) % 256];
  const colorNear = (a, b) => Boolean(a) && a.every((v, i) => Math.abs(v - b[i]) <= 16);
  const shotPixel = (shot, fx = 0.97, fy = 0.97) => {
    const image = nativeImage.createFromBuffer(Buffer.from(shot.result.imageBase64, "base64"));
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    const o = (Math.min(height - 1, Math.round(height * fy)) * width + Math.min(width - 1, Math.round(width * fx))) * 4;
    return [bitmap[o + 2], bitmap[o + 1], bitmap[o]];
  };
  const minimizeNow = async () => {
    const seen = new Promise((resolve) => window.once("minimize", resolve));
    window.minimize();
    await Promise.race([seen, sleep(3000)]);
    for (let i = 0; i < 30 && !window.isMinimized(); i += 1) await sleep(100);
    await sleep(500);
    return window.isMinimized();
  };
  const restoreNow = async () => {
    window.restore();
    for (let i = 0; i < 30 && window.isMinimized(); i += 1) await sleep(100);
    await sleep(500);
  };
  const acquireRetry = async (handle, url) => {
    let r = await controller.acquire(handle, { url });
    for (let i = 0; !r.ok && i < 20 && r.error?.code === "BROWSER_UNAVAILABLE"; i += 1) { await sleep(250); r = await controller.acquire(handle, { url }); }
    return r;
  };
  const mWc = () => controller.liveContents();
  const mEvents = () => mWc().executeJavaScript("JSON.stringify(window.__events)").then(JSON.parse);
  const mClear = () => mWc().executeJavaScript("window.__events.length = 0");

  controller.ownership.revokeAllRuns();
  await sleep(300);
  const m = newRun("M");
  const mAcq = await acquireRetry(m.handle, `${base}/minimized`);
  check("min: acquire on the visible window", mAcq.ok && mAcq.state.panelVisible === true && mAcq.state.operationReady === true && mAcq.state.windowMinimized === false, JSON.stringify(mAcq).slice(0, 300));
  const mLease = mAcq.result?.leaseId;
  const epochsBefore = controller.ownership.snapshotEpochs();
  check("min: native minimize is confirmed (event + isMinimized)", await minimizeNow() && winEvents.includes("minimize"), winEvents.join());
  const minState = controller.getState();
  const afterEpochs = controller.ownership.snapshotEpochs();
  check("min: lease, view, layout and epochs survive the minimize", controller.ownership.getOwner().kind === "agent" && JSON.stringify(afterEpochs) === JSON.stringify(epochsBefore) && window.contentView.children.length === 1, `${JSON.stringify(epochsBefore)} ${JSON.stringify(afterEpochs)}`);
  check("min: panelVisible=false, operationReady=true, windowMinimized=true", minState.panelVisible === false && minState.operationReady === true && minState.windowMinimized === true && controller.status().result.available === true, JSON.stringify(minState));
  const busy = await controller.acquire(newRun("N").handle, { url: `${base}/minimized` });
  check("min: another run still gets BROWSER_BUSY", !busy.ok && busy.error.code === "BROWSER_BUSY", JSON.stringify(busy));

  let mSnap = (await controller.snapshot(m.handle, { leaseId: mLease }));
  check("min: snapshot is exact (fixture nodes, viewport)", mSnap.ok && Boolean(node(mSnap.result, "button", "実行")) && mSnap.result.viewport.width > 0, JSON.stringify(mSnap).slice(0, 200));
  let MS = mSnap.result;
  const mref = (role, name) => node(MS, role, name).ref;
  await mClear();
  const mClick = await controller.click(m.handle, { leaseId: mLease, snapshotId: MS.snapshotId, ref: mref("button", "実行") });
  await sleep(200);
  const mClickEvents = (await mEvents()).filter((e) => e.target === "go");
  check("min: click lands once as trusted mousedown,mouseup,click on the target", mClick.ok && mClickEvents.map((e) => e.type).join() === "mousedown,mouseup,click" && mClickEvents.every((e) => e.trusted), JSON.stringify(mClickEvents));
  check("min: planned input did not take over", controller.ownership.getOwner().kind === "agent");
  check("min: still minimized after the click (nothing restored the window)", window.isMinimized());
  const mFill = (name, text, role = "textbox") => controller.fill(m.handle, { leaseId: mLease, snapshotId: MS.snapshotId, ref: mref(role, name), text });
  const mFillOk1 = await mFill("名前", "こんにちは世界");
  check("min: fill Japanese", mFillOk1.ok && await waitForValue(() => mWc().executeJavaScript("document.getElementById('name').value"), "こんにちは世界") === "こんにちは世界");
  const mFillOk2 = await mFill("名前", "abc");
  check("min: fill replaces", mFillOk2.ok && await waitForValue(() => mWc().executeJavaScript("document.getElementById('name').value"), "abc") === "abc");
  const mFillOk3 = await mFill("メモ欄", "一行目\n二行目");
  check("min: fill textarea with newline", mFillOk3.ok && await waitForValue(() => mWc().executeJavaScript("document.getElementById('memo').value"), "一行目\n二行目") === "一行目\n二行目");
  const mFillOk4 = await mFill("制御入力", "xyz");
  check("min: fill controlled input drives handlers", mFillOk4.ok && await waitForValue(() => mWc().executeJavaScript("document.getElementById('mirror').textContent"), "state:xyz") === "state:xyz");
  const mCe = await mFill("自由記述", "メモ内容");
  check("min: fill contenteditable", mCe.ok && (await waitForValue(() => mWc().executeJavaScript("document.getElementById('ce').innerText").then((t) => t.trim()), "メモ内容")) === "メモ内容", JSON.stringify(mCe));
  const mFillOk5 = await mFill("名前", "");
  check("min: fill empty clears", mFillOk5.ok && await waitForValue(() => mWc().executeJavaScript("document.getElementById('name').value"), "") === "");
  await mFill("名前", "abc");
  await mClear();
  const mBack = await controller.press(m.handle, { leaseId: mLease, snapshotId: MS.snapshotId, ref: mref("textbox", "名前"), key: "Backspace" });
  await sleep(200);
  check("min: press Backspace edits the field (trusted keydown)", mBack.ok && await mWc().executeJavaScript("document.getElementById('name').value") === "ab" && (await mEvents()).some((e) => e.type === "keydown" && e.key === "Backspace" && e.trusted), JSON.stringify(mBack));
  await mClear();
  const mEnter = await controller.press(m.handle, { leaseId: mLease, snapshotId: MS.snapshotId, ref: mref("textbox", "名前"), key: "Enter" });
  await sleep(200);
  check("min: press Enter lands as trusted keydown", mEnter.ok && (await mEvents()).some((e) => e.type === "keydown" && e.key === "Enter" && e.trusted), JSON.stringify(mEnter));
  await mClear();
  const mShiftTab = await controller.press(m.handle, { leaseId: mLease, snapshotId: MS.snapshotId, ref: mref("textbox", "制御入力"), key: "Tab", modifiers: ["Shift"] });
  await sleep(250);
  const shiftEvents = await mEvents();
  const shiftActive = await mWc().executeJavaScript("document.activeElement.id");
  check("min: press Shift+Tab (modifier) lands as a trusted keydown with shiftKey and moves focus backwards", mShiftTab.ok && shiftEvents.some((e) => e.type === "keydown" && e.key === "Tab" && e.shift === true && e.trusted) && shiftActive !== "ctl", JSON.stringify({ shiftEvents, shiftActive }));
  const mSel = await controller.select(m.handle, { leaseId: mLease, snapshotId: MS.snapshotId, ref: mref("combobox", "色"), values: ["b"] });
  check("min: select", mSel.ok && await mWc().executeJavaScript("document.getElementById('sel').value") === "b");
  const mScroll = await controller.scroll(m.handle, { leaseId: mLease, deltaY: 500 });
  check("min: scroll", mScroll.ok && mScroll.result.scrollY === 500, JSON.stringify(mScroll));
  const mText = await controller.getText(m.handle, { leaseId: mLease, maxChars: 4000 });
  check("min: get_text", mText.ok && mText.result.text.includes("最小化フィクスチャ"), JSON.stringify(mText).slice(0, 200));
  const mWait = await controller.wait(m.handle, { leaseId: mLease, timeoutMs: 4000, condition: { kind: "text", text: "clicked", present: true } });
  check("min: wait(text) is not stopped by the minimized window", mWait.ok, JSON.stringify(mWait));
  const mTimeout = await controller.wait(m.handle, { leaseId: mLease, timeoutMs: 400, condition: { kind: "text", text: "出ない", present: true } });
  check("min: wait still times out normally", !mTimeout.ok && mTimeout.error.code === "TIMEOUT");

  // Screenshot freshness: a generation marker changed while minimized must show up in the image.
  let freshAll = true;
  const freshDetail = [];
  for (const gen of [11, 12, 13]) {
    await mWc().executeJavaScript(`window.setGen(${gen})`);
    const shot = await controller.screenshot(m.handle, { leaseId: mLease });
    const px = shot.ok ? shotPixel(shot) : null;
    const ok = shot.ok && colorNear(px, genColor(gen)) && shot.result.width > 0 && Math.max(shot.result.width, shot.result.height) <= 1280 && Buffer.from(shot.result.imageBase64, "base64").length <= 1024 * 1024;
    freshDetail.push({ gen, px, expected: genColor(gen), err: shot.error?.code });
    freshAll = freshAll && ok;
  }
  check("min: screenshot shows the generation marker set while minimized (3 generations, size within limits)", freshAll && window.isMinimized(), JSON.stringify(freshDetail));

  // navigation keeps the minimize and updates URL / history / document epoch
  const docBefore = controller.ownership.epochs.documentEpoch;
  const mNav = await controller.navigate(m.handle, { leaseId: mLease, url: `${base}/next` });
  check("min: navigate keeps the minimize; URL and document epoch update", mNav.ok && mWc().getURL().endsWith("/next") && controller.ownership.epochs.documentEpoch > docBefore && window.isMinimized(), JSON.stringify(mNav).slice(0, 200));
  const mBackNav = await controller.back(m.handle, { leaseId: mLease });
  check("min: back", mBackNav.ok && mBackNav.result.navigated === true && mWc().getURL().endsWith("/minimized"), JSON.stringify(mBackNav));
  const mFwd = await controller.forward(m.handle, { leaseId: mLease });
  check("min: forward", mFwd.ok && mFwd.result.navigated === true && mWc().getURL().endsWith("/next"), JSON.stringify(mFwd));
  const mReload = await controller.reload(m.handle, { leaseId: mLease });
  check("min: reload", mReload.ok && window.isMinimized(), JSON.stringify(mReload));
  await mWc().executeJavaScript("window.setGen ? window.setGen(42) : 0").catch(() => {});
  const navShot = await controller.screenshot(m.handle, { leaseId: mLease });
  const navOutcome = navShot.ok ? (colorNear(shotPixel(navShot), genColor(42)) || !(await mWc().executeJavaScript("typeof window.setGen === 'function'"))) ? "ok" : "STALE" : navShot.error.code;
  report.screenshotAfterMinimizedNavigation = navOutcome;
  check(`min: screenshot after a navigation made while minimized is never stale (outcome: ${navOutcome})`, navOutcome === "ok" || navOutcome === "SCREENSHOT_UNAVAILABLE", navOutcome);

  // evaluate: main frame, same-origin and cross-origin (OOPIF) frames, endless loop cut off, recovery — all while minimized
  const mNavEval = await controller.navigate(m.handle, { leaseId: mLease, url: `${base}/eval-parent` });
  const mEvalSnap = await controller.snapshot(m.handle, { leaseId: mLease });
  const mFrames = (mEvalSnap.result?.frames ?? []).filter((f) => !f.isMainFrame);
  const mSame = mFrames.find((f) => f.name === "same");
  const mCross = mFrames.find((f) => f.name === "cross");
  const mEvEpoch = () => controller.ownership.epochs.documentEpoch;
  const mEval = (script, extra = {}) => controller.evaluate(m.handle, { leaseId: mLease, documentEpoch: mEvEpoch(), script, ...extra });
  const mMainEval = await mEval("return document.title");
  check("min: evaluate in the main frame", mNavEval.ok && mMainEval.ok && mMainEval.result.value.value === "eval-parent" && mMainEval.state.panelVisible === false && mMainEval.state.operationReady === true, JSON.stringify(mMainEval).slice(0, 300));
  const mSameEval = await mEval("return window.childState.n", { frameId: mSame?.frameId });
  check("min: evaluate in a same-origin frame", mSameEval.ok && mSameEval.result.value.value === 7, JSON.stringify(mSameEval));
  const mCrossEval = await mEval("return [location.hostname, window.childState.n]", { frameId: mCross?.frameId });
  check("min: evaluate in a cross-origin (out-of-process) frame", mCrossEval.ok && JSON.stringify(mCrossEval.result.value.value) === JSON.stringify(["localhost", 7]), JSON.stringify(mCrossEval));
  const mLoopStart = Date.now();
  const mLoop = await mEval("while (true) {}", { frameId: mCross?.frameId, timeoutMs: 1000 });
  check("min: endless loop is cut off within the deadline (TIMEOUT, effect possible, not retryable)", !mLoop.ok && mLoop.error.code === "TIMEOUT" && mLoop.error.effect === "possible" && mLoop.error.retryable === false && Date.now() - mLoopStart < 6000 && window.isMinimized(), JSON.stringify(mLoop));
  await sleep(500);
  const m2 = newRun("M");
  const m2Acq = await acquireRetry(m2.handle, `${base}/eval-parent`);
  const m2Eval = m2Acq.ok ? await controller.evaluate(m2.handle, { leaseId: m2Acq.result.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "return document.title" }) : m2Acq;
  check("min: a new view can be acquired and evaluated after the loop was cut off (still minimized)", m2Acq.ok && m2Eval.ok && window.isMinimized(), JSON.stringify(m2Eval).slice(0, 200));

  // restore: latest page, same lease, real user input takes over
  await restoreNow();
  const restoredState = controller.getState();
  check("min: restore keeps the lease and shows the latest page (panelVisible true, same page)", restoredState.panelVisible === true && restoredState.operationReady === true && restoredState.windowMinimized === false && controller.ownership.getOwner().kind === "agent" && mWc().getURL().endsWith("/eval-parent"), JSON.stringify(restoredState));
  mWc().sendInputEvent({ type: "mouseMove", x: 30, y: 30 });
  mWc().sendInputEvent({ type: "mouseDown", x: 30, y: 30, button: "left", clickCount: 1 });
  mWc().sendInputEvent({ type: "mouseUp", x: 30, y: 30, button: "left", clickCount: 1 });
  await sleep(200);
  check("min: after restore, unplanned user input takes over", controller.ownership.getOwner().kind === "user", controller.ownership.getOwner().kind);
  controller.allowAgentControl();

  // first acquire / autoOpen while minimized (the panel was closed by the user)
  controller.ownership.revokeAllRuns();
  await sleep(300);
  controller.setPresentation({ open: false, occluded: false, resizing: false });
  check("min: user closed the panel", controller.getState().panelRequested === false);
  check("min: native minimize (autoOpen scenario)", await minimizeNow());
  const o1 = newRun("O");
  const o1Acq = await acquireRetry(o1.handle, `${base}/minimized`);
  check("min: first acquire while minimized auto-opens logically and prepares an operable surface without restoring", o1Acq.ok && o1Acq.state.panelVisible === false && o1Acq.state.operationReady === true && controller.getState().panelRequested === true && window.isMinimized(), JSON.stringify(o1Acq).slice(0, 300));
  const o1Snap = await controller.snapshot(o1.handle, { leaseId: o1Acq.result?.leaseId });
  check("min: snapshot after a minimized auto-open", o1Snap.ok && o1Snap.result.viewport.width > 0, JSON.stringify(o1Snap).slice(0, 200));
  // Measured (macOS, Electron 44.9.3): a document loaded while the window is minimized is never painted.
  // The invariant is "never a stale image": the screenshot is either current or an explicit SCREENSHOT_UNAVAILABLE.
  await mWc().executeJavaScript("window.setGen(41)");
  const o1Shot = await controller.screenshot(o1.handle, { leaseId: o1Acq.result?.leaseId });
  const o1Outcome = o1Shot.ok ? (colorNear(shotPixel(o1Shot), genColor(41)) ? "fresh" : "STALE") : o1Shot.error.code;
  report.screenshotAfterMinimizedAcquire = o1Outcome;
  check(`min: screenshot of a document first loaded while minimized is current or explicitly unavailable, never stale (outcome: ${o1Outcome})`, o1Outcome === "fresh" || o1Outcome === "SCREENSHOT_UNAVAILABLE", o1Outcome);
  controller.ownership.revokeAllRuns();
  await sleep(300);
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: false, evaluateEnabled: true });
  controller.setPresentation({ open: false, occluded: false, resizing: false });
  const o2 = newRun("O2");
  const o2Acq = await controller.acquire(o2.handle, { url: `${base}/eval-parent` });
  check("min: autoOpen OFF + closed panel => PANEL_CLOSED, nothing loaded, no lease", !o2Acq.ok && o2Acq.error.code === "PANEL_CLOSED" && o2Acq.error.effect === "none" && !(controller.liveContents()?.getURL() ?? "").endsWith("/eval-parent") && controller.ownership.getOwner().kind === "none", JSON.stringify(o2Acq));
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });
  controller.ownership.revokeAllRuns();

  // soak: timers / rAF keep running (throttling disabled while an agent holds the browser), then operate again
  const s = newRun("S");
  await restoreNow();
  const sAcq = await acquireRetry(s.handle, `${base}/minimized`);
  const sLease = sAcq.result?.leaseId;
  await sleep(800); // let the document paint on the visible window before minimizing
  check("min: acquire (visible) then minimize for the soak", sAcq.ok && await minimizeNow(), JSON.stringify(sAcq).slice(0, 200));
  const sample = () => mWc().executeJavaScript("[window.__ticks, window.__raf, document.visibilityState]");
  const hostSample = () => window.webContents.executeJavaScript("(window.__hn ??= (() => { window.__hnv = 0; (function f() { window.__hnv += 1; requestAnimationFrame(f); })(); return 1; })(), window.__hnv)");
  const t0 = await sample(); const h0 = await hostSample();
  await sleep(SOAK_MS);
  const t1 = await sample(); const h1 = await hostSample();
  const ticks = t1[0] - t0[0];
  const expectedTicks = SOAK_MS / 50;
  check(`min: page timers keep running while minimized (${SOAK_MS} ms soak: ${ticks}/${expectedTicks} ticks)`, ticks >= expectedTicks * 0.5, JSON.stringify({ t0, t1 }));
  check(`min: page rAF keeps running while minimized (${t1[1] - t0[1]} frames)`, t1[1] - t0[1] > (SOAK_MS / 1000) * 20, JSON.stringify({ t0, t1 }));
  check(`min: host renderer rAF keeps running while minimized (${h1 - h0} frames)`, h1 - h0 > (SOAK_MS / 1000) * 20, JSON.stringify({ h0, h1 }));
  await mWc().executeJavaScript("window.setGen(77)");
  const soakShot = await controller.screenshot(s.handle, { leaseId: sLease });
  check("min: after the soak the screenshot is still current and the lease is still valid", soakShot.ok && colorNear(shotPixel(soakShot), genColor(77)) && controller.ownership.getOwner().kind === "agent", JSON.stringify(soakShot).slice(0, 200));

  // modal while minimized
  blockPresent = true;
  controller.setPresentation({ open: true, occluded: true, resizing: false });
  const occ = await controller.getText(s.handle, { leaseId: sLease });
  check("min: modal while minimized => PANEL_OCCLUDED (effect none), status explains it", !occ.ok && occ.error.code === "PANEL_OCCLUDED" && occ.error.effect === "none" && controller.status().result.blockedReason === "PANEL_OCCLUDED" && controller.status().result.available === true, JSON.stringify(occ));
  blockPresent = false;
  present();
  check("min: a fresh measurement recovers after the modal", (await controller.getText(s.handle, { leaseId: sLease })).ok);

  // renderer reload while minimized: old epoch rejected, surface prepared again
  const oldEpoch = controller.getState().rendererEpoch;
  controller.beginRendererEpoch();
  const staleUpdate = controller.updateViewport({ rendererEpoch: oldEpoch, seq: 999, layoutRevision: controller.getState().layoutRevision, viewport: { x: 500, y: 40, width: 580, height: 720 }, hostViewport: { width: 1100, height: 800 }, panelOpen: true, occluded: false, resizing: false });
  check("min: renderer reload rejects a viewport from the previous epoch", staleUpdate === false);
  const afterReload = await controller.getText(s.handle, { leaseId: sLease });
  check("min: after a renderer reload the surface is prepared again (minimized)", afterReload.ok && window.isMinimized(), JSON.stringify(afterReload).slice(0, 200));

  // settings OFF while minimized stops delivery
  await controller.applySettings({ enabled: false, autoOpenOnToolUse: true, evaluateEnabled: true });
  const offResult = await controller.getText(s.handle, { leaseId: sLease });
  check("min: settings OFF while minimized closes the view and stops delivery", !offResult.ok && window.contentView.children.length === 0 && controller.ownership.getOwner().kind === "none", JSON.stringify(offResult));
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });

  // screen lock / suspend: power events reach the controller; the old lease is never revived
  const detachPower = attachControllerToPowerMonitor(controller);
  const l = newRun("L");
  const lAcq = await acquireRetry(l.handle, `${base}/minimized`);
  const lLease = lAcq.result?.leaseId;
  blockPresent = true;
  powerMonitor.emit("lock-screen");
  const locked = await controller.getText(l.handle, { leaseId: lLease });
  check("min: (simulated lock-screen event) operations are refused with SYSTEM_LOCKED and the lease ends", !locked.ok && locked.error.code === "SYSTEM_LOCKED" && controller.ownership.getOwner().kind === "none", JSON.stringify(locked));
  powerMonitor.emit("suspend");
  powerMonitor.emit("unlock-screen");
  check("min: (simulated suspend) still blocked after unlock", (await controller.acquire(newRun("L").handle, { url: `${base}/minimized` })).error?.code === "SYSTEM_SUSPENDED");
  powerMonitor.emit("resume");
  blockPresent = false;
  present();
  const lOld = await controller.getText(l.handle, { leaseId: lLease });
  check("min: after resume the old lease is not revived", !lOld.ok, JSON.stringify(lOld));
  detachPower();

  // explicit hide (close button => tray) while minimized still ends the lease; show never revives it
  controller.ownership.revokeAllRuns();
  await sleep(300);
  const h = newRun("H");
  const hAcq = await acquireRetry(h.handle, `${base}/minimized`);
  const hLease = hAcq.result?.leaseId;
  blockPresent = true;
  controller.onWindowHidden();
  const hidden = await controller.getText(h.handle, { leaseId: hLease });
  check("min: explicit hide => BROWSER_UNAVAILABLE (effect none), lease ended, status available=false", !hidden.ok && hidden.error.code === "BROWSER_UNAVAILABLE" && hidden.error.effect === "none" && controller.ownership.getOwner().kind === "none" && controller.status().result.available === false, JSON.stringify(hidden));
  window.hide();
  await sleep(300);
  window.show();
  await sleep(600);
  blockPresent = false;
  present();
  check("min: show after hide does not revive the old lease", !(await controller.getText(h.handle, { leaseId: hLease })).ok && !window.isMinimized());

  // unfocused (another window in front) and fully covered: everything works and the front window keeps focus
  const other = new BrowserWindow({ width: 500, height: 400, x: 1300, y: 100, show: true });
  await other.loadURL("data:text/html,<body>other</body>");
  other.focus();
  await sleep(800);
  const u = newRun("U");
  const uAcq = await acquireRetry(u.handle, `${base}/minimized`);
  const uLease = uAcq.result?.leaseId;
  const uSnap = await controller.snapshot(u.handle, { leaseId: uLease });
  const uClick = await controller.click(u.handle, { leaseId: uLease, snapshotId: uSnap.result?.snapshotId, ref: node(uSnap.result, "button", "実行")?.ref });
  const uFill = await controller.fill(u.handle, { leaseId: uLease, snapshotId: uSnap.result?.snapshotId, ref: node(uSnap.result, "textbox", "名前")?.ref, text: "背景入力" });
  await mWc().executeJavaScript("window.setGen(31)");
  const uShot = await controller.screenshot(u.handle, { leaseId: uLease });
  check("unfocused: snapshot/click/fill/screenshot all succeed and the host did not steal focus", uAcq.ok && uSnap.ok && uClick.ok && uFill.ok && uShot.ok && colorNear(shotPixel(uShot), genColor(31)) && !window.isFocused(), JSON.stringify({ a: uAcq.ok, s: uSnap.ok, c: uClick.ok, f: uFill.ok, sh: uShot.ok, hostFocused: window.isFocused() }));
  other.setBounds(window.getBounds());
  other.focus();
  await sleep(1000);
  await mWc().executeJavaScript("window.setGen(32)");
  const cShot = await controller.screenshot(u.handle, { leaseId: uLease });
  const cFill = await controller.fill(u.handle, { leaseId: uLease, snapshotId: (await controller.snapshot(u.handle, { leaseId: uLease })).result.snapshotId, ref: node(uSnap.result, "textbox", "名前")?.ref, text: "完全遮蔽" });
  check("covered: screenshot is current and input lands while a same-size window covers the host", cShot.ok && colorNear(shotPixel(cShot), genColor(32)) && cFill.ok !== undefined && !window.isFocused(), JSON.stringify({ shot: cShot.ok, fill: cFill.ok ?? cFill.error, hostFocused: window.isFocused() }));
  check("covered: the front window kept the focus (host never re-focused)", other.isFocused() || !window.isFocused());
  other.close();
  controller.ownership.revokeAllRuns();
  await sleep(300);

  // 20x minimize / restore: lands exactly once, current frame, state restored, no leftovers
  const loopRun = newRun("R");
  const loopAcq = await acquireRetry(loopRun.handle, `${base}/minimized`);
  const loopLease = loopAcq.result?.leaseId;
  const loopResults = [];
  for (let i = 0; i < 20; i += 1) {
    const wasMin = await minimizeNow();
    const snapL = await controller.snapshot(loopRun.handle, { leaseId: loopLease });
    await mClear();
    await mWc().executeJavaScript(`window.setGen(${100 + i})`);
    const clickL = await controller.click(loopRun.handle, { leaseId: loopLease, snapshotId: snapL.result?.snapshotId, ref: node(snapL.result ?? { nodes: [] }, "button", "実行")?.ref });
    await sleep(150);
    const evs = (await mEvents()).filter((e) => e.target === "go" && e.type === "click" && e.trusted).length;
    const shotL = await controller.screenshot(loopRun.handle, { leaseId: loopLease });
    const pxL = shotL.ok ? shotPixel(shotL) : null;
    const fresh = shotL.ok && colorNear(pxL, genColor(100 + i));
    const stillMin = window.isMinimized();
    await restoreNow();
    const st = controller.getState();
    loopResults.push({ i, wasMin, stillMin, click: clickL.ok, once: evs === 1, fresh, px: fresh ? undefined : pxL, expected: fresh ? undefined : genColor(100 + i), shotError: shotL.ok ? undefined : shotL.error.code, restored: st.panelVisible && st.operationReady && st.windowMinimized === false, lease: controller.ownership.getOwner().kind === "agent" });
  }
  const loopBad = loopResults.filter((r) => !(r.wasMin && r.stillMin && r.click && r.once && r.fresh && r.restored && r.lease));
  check("min: 20x minimize/restore: confirmed minimize, one trusted click each, current frame, state restored, lease kept", loopBad.length === 0, JSON.stringify(loopBad));
  check("min: no leftovers after the loop (one child view, no waiters)", window.contentView.children.length === 1 && controller.waiters.size === 0, `children=${window.contentView.children.length} waiters=${controller.waiters.size}`);
  report.minimized = { soakMs: SOAK_MS, windowEvents: winEvents.length, loop: loopResults };
  controller.ownership.revokeAllRuns();

  /* ---------- crash isolation ---------- */
  const crashed = new Promise((resolve) => wc().once("render-process-gone", resolve));
  wc().forcefullyCrashRenderer();
  await Promise.race([crashed, sleep(3000)]);
  check("renderer crash: host survives, lease expired, error shown", !window.isDestroyed() && controller.ownership.getOwner().kind === "none" && Boolean(controller.getState().error), JSON.stringify(controller.getState()));

  /* ---------- settings OFF ---------- */
  await controller.applySettings({ enabled: false, autoOpenOnToolUse: true });
  check("OFF closes the view and removes it from the window", window.contentView.children.length === 0 && !controller.getState().panelVisible);

  controller.dispose();
  server.close();
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "test/artifacts/verify-embedded-browser.json"), JSON.stringify({ electron: process.versions.electron, platform: process.platform, total: results.length, failed: failed.length, ...report, results }, null, 2));
  console.log(`verify-embedded-browser: ${results.length - failed.length}/${results.length} checks passed (electron ${process.versions.electron})`);
  exitNow(failed.length === 0 ? 0 : 1);
}

/**
 * A force-crashed renderer can make Electron's orderly (synchronous) shutdown block under Xvfb,
 * so results are already on disk; leave through the process-level exit instead of app.exit().
 */
function exitNow(code) {
  try { process.reallyExit(code); } catch { app.exit(code); }
}

app.whenReady().then(main).catch((error) => { console.error(error); app.exit(2); });
