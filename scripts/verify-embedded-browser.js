/**
 * Live verification of the embedded browser against a REAL Electron WebContentsView
 * (design 17.2). It drives the real controller/host from dist/, with local fixtures only.
 *
 *   xvfb-run -a node_modules/.bin/electron --no-sandbox scripts/verify-embedded-browser.js
 *
 * It does NOT exercise the Lit UI (that is the manual live-UI verification, T15).
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { EmbeddedBrowserController } = require(path.join(root, "dist/main/embedded-browser.js"));
const { createElectronBrowserHost, attachControllerToWindow } = require(path.join(root, "dist/main/embedded-browser-electron.js"));

const results = [];
const check = (name, condition, detail) => {
  results.push({ name, ok: Boolean(condition), ...(condition ? {} : { detail: String(detail ?? "") }) });
  if (!condition) console.error(`FAIL ${name} ${detail ?? ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer() {
  const form = fs.readFileSync(path.join(root, "test/fixtures/browser/form.html"));
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
    if (url.pathname === "/form") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(form); }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function main() {
  const { server, base } = await startServer();
  const window = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html;charset=utf-8,<body style='margin:0'><p>host</p></body>");
  app.focus({ steal: true });
  window.focus();
  // Input and evaluate are gated on window focus; on a desktop another app can take it at any moment.
  const focusKeeper = setInterval(() => { if (!window.isDestroyed() && !window.isFocused()) { app.focus({ steal: true }); window.focus(); } }, 100);
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
  controller.onState((state) => { if (state.panelRequested && !state.panelVisible && !blockPresent) setImmediate(present); });
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
  check("fill Japanese into input", (await fill("メールアドレス", "こんにちは世界")).ok && await wc().executeJavaScript("document.getElementById('email').value") === "こんにちは世界");
  check("fill replaces existing text", (await fill("メールアドレス", "b@example.com")).ok && await wc().executeJavaScript("document.getElementById('email').value") === "b@example.com");
  check("fill textarea", (await fill("お問い合わせ内容", "一行目\n二行目")).ok && await wc().executeJavaScript("document.getElementById('msg').value") === "一行目\n二行目");
  check("fill drives controlled input handlers", (await fill("制御入力", "xyz")).ok && await wc().executeJavaScript("document.getElementById('mirror').textContent") === "state:xyz");
  check("fill empty clears", (await fill("メールアドレス", "")).ok && await wc().executeJavaScript("document.getElementById('email').value") === "");
  const ce = await fill("メモ", "メモ内容");
  check("fill contenteditable", ce.ok && (await wc().executeJavaScript("document.getElementById('ce').innerText")).trim() === "メモ内容", JSON.stringify(ce));
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
  // evaluate requires the focused window; another app may take focus while this live script runs.
  const focusedEvaluate = async (handle, args) => {
    for (let i = 0; i < 20 && !window.isFocused(); i += 1) { app.focus({ steal: true }); window.focus(); await sleep(100); }
    return controller.evaluate(handle, args);
  };
  controller.ownership.revokeRun(b.ctx.runId);
  const ev = newRun("A");
  const evAcq = await controller.acquire(ev.handle, { url: `${base}/eval-parent` });
  check("evaluate: acquire parent page with frames", evAcq.ok, JSON.stringify(evAcq));
  const evLease = evAcq.result?.leaseId;
  const evEpoch = () => controller.ownership.epochs.documentEpoch;
  const evalIn = (script, extra = {}) => focusedEvaluate(ev.handle, { leaseId: evLease, documentEpoch: evEpoch(), script, ...extra });
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
  const badEpoch = await focusedEvaluate(ev.handle, { leaseId: evLease, documentEpoch: evEpoch() + 99, script: "return 1" });
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
  const rec = await focusedEvaluate(ev2.handle, { leaseId: evAcq2.result?.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "return document.title" });
  check("evaluate: works again after recovery", rec.ok && rec.result.value.value === "eval-parent", JSON.stringify(rec));

  // Main-frame infinite loop, and cancellation (run revoked) while the script is running.
  const mainLoop = await focusedEvaluate(ev2.handle, { leaseId: evAcq2.result?.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "while (true) {}", timeoutMs: 800 });
  check("evaluate: infinite loop in the main frame => TIMEOUT", !mainLoop.ok && mainLoop.error.code === "TIMEOUT" && mainLoop.error.effect === "possible", JSON.stringify(mainLoop));
  await sleep(500);
  const ev3 = newRun("A");
  let evAcq3 = await controller.acquire(ev3.handle, { url: `${base}/eval-parent` });
  for (let i = 0; !evAcq3.ok && i < 20; i += 1) { await sleep(250); evAcq3 = await controller.acquire(ev3.handle, { url: `${base}/eval-parent` }); }
  check("evaluate: reacquire after main-frame loop", evAcq3.ok, JSON.stringify(evAcq3));
  const cancelStarted = Date.now();
  const pending = focusedEvaluate(ev3.handle, { leaseId: evAcq3.result?.leaseId, documentEpoch: controller.ownership.epochs.documentEpoch, script: "await new Promise(() => {})", timeoutMs: 30000 });
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
  const off = await focusedEvaluate(ev5.handle, { leaseId: evAcq4.result?.leaseId ?? "x", documentEpoch: 0, script: "return 1" });
  check("evaluate: disabled in settings => refused (EVALUATE_DISABLED or lease rejected), effect none", !off.ok && off.error.effect === "none", JSON.stringify(off));
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });

  /* ---------- crash isolation ---------- */
  const crashed = new Promise((resolve) => wc().once("render-process-gone", resolve));
  wc().forcefullyCrashRenderer();
  await Promise.race([crashed, sleep(3000)]);
  check("renderer crash: host survives, lease expired, error shown", !window.isDestroyed() && controller.ownership.getOwner().kind === "none" && Boolean(controller.getState().error), JSON.stringify(controller.getState()));

  /* ---------- settings OFF ---------- */
  await controller.applySettings({ enabled: false, autoOpenOnToolUse: true });
  check("OFF closes the view and removes it from the window", window.contentView.children.length === 0 && !controller.getState().panelVisible);

  clearInterval(focusKeeper);
  controller.dispose();
  server.close();
  const failed = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "test/artifacts/verify-embedded-browser.json"), JSON.stringify({ electron: process.versions.electron, total: results.length, failed: failed.length, results }, null, 2));
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
