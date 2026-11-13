const test = require("node:test");
const assert = require("node:assert/strict");
const { EmbeddedBrowserController } = require("../dist/main/embedded-browser.js");
const { FakeHost, presentPanel } = require("./helpers/browser-fakes.js");

const URL1 = "https://example.com/a";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isProgram = (code) => code.includes("__ser");

async function setup({ evaluateEnabled = true, conversation = "A" } = {}) {
  const host = new FakeHost();
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true, evaluateEnabled });
  controller.beginRendererEpoch();
  // Like the real renderer: it can only answer for a view that exists (an abandoned view has nothing to show).
  controller.onState((state) => { if (state.panelRequested && !state.operationReady && host.attached.size > 0 && host.rendererAnswers !== false) setImmediate(() => presentPanel(controller)); });
  const issue = (id) => {
    const ctx = controller.issueRun({ conversationId: id, requestId: `req-${id}`, policyRevision: 1 });
    const abort = new AbortController();
    return { ctx, abort, handle: { runId: ctx.runId, conversationId: id, signal: AbortSignal.any([abort.signal, controller.ownership.resolveToken(ctx.token).signal]) } };
  };
  const a = issue(conversation);
  const acquired = await controller.acquire(a.handle, { url: URL1 });
  assert.equal(acquired.ok, true, JSON.stringify(acquired));
  const lease = acquired.result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.snapshot = async (args) => ({ ok: true, snapshot: { format: "dom-v1", snapshotId: args.snapshotId, documentEpoch: args.documentEpoch, viewport: { width: 480, height: 700 }, nodes: [], text: "", truncated: false, limitations: [] } });
  const epoch = () => controller.status().state.documentEpoch;
  const evaluate = (script, extra = {}) => controller.evaluate(a.handle, { leaseId: lease, documentEpoch: epoch(), script, ...extra });
  return { host, controller, issue, a, lease, wc, epoch, evaluate, main: wc.mainFrame };
}
const programRuns = (frame) => frame.executed.filter((e) => isProgram(e.code)).length;

test("success on the main frame: JSON value, frame info, state; token step then exactly ONE guarded delivery with userGesture=false", async () => {
  const { evaluate, main, wc } = await setup();
  const result = await evaluate("return { title: document.title, n: [1, 2] };");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.result.value, { type: "json", value: { title: "T", n: [1, 2] } });
  assert.equal(result.result.frameUrl, URL1);
  assert.equal(result.result.frameOrigin, "https://example.com");
  assert.match(result.result.frameId, /^f/);
  assert.equal(result.state.url, URL1);
  assert.equal(main.executed.length, 2);
  assert.equal(programRuns(main), 1);
  assert.ok(main.executed.every((e) => e.userGesture === false));
  assert.equal(wc.calls.includes("close"), false, "a normal finish leaves the page open");
});

test("top-level undefined is {type:'undefined'}; a script that returns nothing too", async () => {
  const { evaluate } = await setup();
  assert.deepEqual((await evaluate("return undefined;")).result.value, { type: "undefined" });
  assert.deepEqual((await evaluate("document.title = 'x';")).result.value, { type: "undefined" });
});

test("evaluate OFF: EVALUATE_DISABLED (effect none, no retry) and nothing is delivered; browser OFF: BROWSER_DISABLED", async () => {
  const off = await setup({ evaluateEnabled: false });
  const refused = await off.evaluate("return 1;");
  assert.deepEqual(refused.error, { code: "EVALUATE_DISABLED", message: refused.error.message, retryable: false, effect: "none" });
  assert.equal(off.main.executed.length, 0);
  assert.equal(off.controller.status().result.evaluateEnabled, false);
  assert.equal(off.controller.isEvaluateEnabled(), false);

  const on = await setup();
  assert.equal(on.controller.status().result.evaluateEnabled, true);
  await on.controller.applySettings({ enabled: false, autoOpenOnToolUse: true, evaluateEnabled: true });
  const disabled = await on.evaluate("return 1;");
  assert.equal(disabled.error.code, "BROWSER_DISABLED");
  assert.equal(disabled.error.effect, "none");
  assert.equal(on.controller.status().result.evaluateEnabled, false, "reports unavailable while the browser itself is OFF");
});

test("another run's lease / a run without a lease cannot evaluate", async () => {
  const f = await setup();
  const b = f.issue("B");
  const stolen = await f.controller.evaluate(b.handle, { leaseId: f.lease, documentEpoch: f.epoch(), script: "return 1;" });
  assert.equal(stolen.ok, false);
  assert.ok(["BROWSER_BUSY", "LEASE_EXPIRED", "BROWSER_NOT_OWNED"].includes(stolen.error.code), stolen.error.code);
  assert.equal(stolen.error.effect, "none");
  const bogus = await f.controller.evaluate(f.a.handle, { leaseId: "nope", documentEpoch: f.epoch(), script: "return 1;" });
  assert.equal(bogus.error.code, "LEASE_EXPIRED");
  assert.equal(f.main.executed.length, 0);
});

test("stale documentEpoch is STALE_DOCUMENT (effect none) and nothing is delivered", async () => {
  const f = await setup();
  const old = f.epoch();
  await f.controller.navigate(f.a.handle, { leaseId: f.lease, url: "https://example.com/b" });
  const before = f.main.executed.length;
  const stale = await f.controller.evaluate(f.a.handle, { leaseId: f.lease, documentEpoch: old, script: "return 1;" });
  assert.equal(stale.error.code, "STALE_DOCUMENT");
  assert.equal(stale.error.effect, "none");
  assert.equal(f.main.executed.length, before);
  assert.equal((await f.evaluate("return 2;")).ok, true, "the current epoch works");
});

test("evaluate runs while the window is unfocused or minimized (panelVisible=false, operationReady=true)", async () => {
  const f = await setup();
  f.host.windowFocused = false;
  const unfocused = await f.evaluate("return 1;");
  assert.equal(unfocused.ok, true, JSON.stringify(unfocused));
  f.host.minimize();
  f.controller.onWindowMinimized();
  const minimized = await f.evaluate("return 2;");
  assert.equal(minimized.ok, true, JSON.stringify(minimized));
  assert.equal(minimized.state.panelVisible, false);
  assert.equal(minimized.state.operationReady, true);
  assert.equal(minimized.state.windowMinimized, true);
  f.host.restore();
  f.controller.onWindowRestored();
});

test("gates: occluded panel, hidden window, screen lock refuse before delivery (effect none)", async () => {
  const f = await setup();
  f.controller.setPresentation({ open: true, occluded: true, resizing: false });
  const occluded = await f.evaluate("return 1;");
  assert.equal(occluded.error.code, "PANEL_OCCLUDED");
  assert.equal(occluded.error.effect, "none");
  assert.equal(f.main.executed.length, 0);
  presentPanel(f.controller);
  f.host.rendererAnswers = false; // a locked / hidden app has no renderer that answers layout requests
  f.controller.onSystemLocked();
  const locked = await f.evaluate("return 1;");
  assert.equal(locked.error.code, "SYSTEM_LOCKED");
  assert.equal(locked.error.effect, "none");
  f.controller.onSystemUnlocked();
  f.controller.onWindowHidden();
  const hidden = await f.evaluate("return 1;");
  assert.equal(hidden.error.code, "BROWSER_UNAVAILABLE");
  assert.equal(hidden.error.effect, "none");
  assert.equal(f.main.executed.length, 0);
});

test("script syntax errors are SCRIPT_SYNTAX_ERROR, effect none, and nothing runs in the page", async () => {
  const f = await setup();
  const bad = await f.evaluate("return (");
  assert.equal(bad.error.code, "SCRIPT_SYNTAX_ERROR");
  assert.equal(bad.error.effect, "none");
  assert.equal(bad.error.retryable, false);
  assert.equal(f.main.executed.length, 0);
  const breakout = await f.evaluate("}); globalThis.pwned = 1; (function(){");
  assert.equal(breakout.error.code, "SCRIPT_SYNTAX_ERROR");
});

test("post-delivery failures are effect=possible and retryable=false: throw, rejection, not serializable, too large", async () => {
  const f = await setup();
  for (const [script, code] of [
    ["document.title = 'sent'; throw new Error('late');", "SCRIPT_EXECUTION_ERROR"],
    ["await Promise.reject(new Error('r'));", "SCRIPT_EXECUTION_ERROR"],
    ["return { f() {} };", "RESULT_NOT_SERIALIZABLE"],
    ["return 'x'.repeat(70000);", "RESULT_TOO_LARGE"]
  ]) {
    const result = await f.evaluate(script);
    assert.equal(result.ok, false, script);
    assert.equal(result.error.code, code, script);
    assert.equal(result.error.effect, "possible", script);
    assert.equal(result.error.retryable, false, script);
  }
  assert.equal(programRuns(f.main), 4, "one delivery each: never re-sent automatically");
});

test("every evaluate invalidates earlier snapshot refs (even a read-only one)", async () => {
  const f = await setup();
  f.wc.pageHandlers.getText = async () => ({ ok: true, text: "x", truncated: false });
  const snap = await f.controller.snapshot(f.a.handle, { leaseId: f.lease });
  const snapshotId = snap.result.snapshotId;
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease, snapshotId, ref: "r" })).ok, true);
  assert.equal((await f.evaluate("return document.title;")).ok, true);
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease, snapshotId, ref: "r" })).error.code, "STALE_REF");
  const fresh = await f.controller.snapshot(f.a.handle, { leaseId: f.lease });
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease, snapshotId: fresh.result.snapshotId, ref: "r" })).ok, true);
});

test("snapshot carries the frame list only while evaluate is enabled; the DOM snapshot contract is unchanged", async () => {
  const on = await setup();
  on.wc.addFrame({ url: "https://other.example/c", name: "child", processId: 2 });
  const withFrames = await on.controller.snapshot(on.a.handle, { leaseId: on.lease });
  assert.equal(withFrames.result.format, "dom-v1");
  assert.equal(withFrames.result.frames.length, 2);
  assert.equal(withFrames.result.frames[0].isMainFrame, true);
  assert.equal(withFrames.result.framesTruncated, false);
  const off = await setup({ evaluateEnabled: false });
  off.wc.addFrame({ url: "https://other.example/c", name: "child" });
  const without = await off.controller.snapshot(off.a.handle, { leaseId: off.lease });
  assert.equal("frames" in without.result, false);
  assert.equal("framesTruncated" in without.result, false);
});

test("child frame: runs in that frame (cross-origin included); result reports the frame, state reports the top document", async () => {
  const f = await setup();
  const child = f.wc.addFrame({ url: "https://other.example/c", name: "child", processId: 2 });
  const nested = f.wc.addFrame({ url: "https://third.example/n", parent: child, name: "nested", processId: 3 });
  const blank = f.wc.addFrame({ url: "about:blank", origin: "https://example.com", name: "blank" });
  const { frames } = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result;
  const idOf = (name) => frames.find((x) => x.name === name).frameId;
  for (const [name, frame] of [["child", child], ["nested", nested], ["blank", blank]]) {
    const result = await f.evaluate(`return location_${name} ?? document.title;`.replace("location_" + name + " ?? ", ""), { frameId: idOf(name) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.frameId, idOf(name));
    assert.equal(result.result.frameUrl, frame.url);
    assert.equal(result.result.frameOrigin, frame.origin);
    assert.equal(result.state.url, URL1, "state describes the top document");
    assert.equal(programRuns(frame), 1);
    assert.equal(programRuns(f.main), 0, "the main frame was not touched");
  }
});

test("opaque / non-http(s) frames are refused with UNSUPPORTED_TARGET (effect none)", async () => {
  const f = await setup();
  f.wc.addFrame({ url: "https://s.example/", origin: "null", name: "sandboxed" });
  f.wc.addFrame({ url: "data:text/html,x", origin: "null", name: "data" });
  const { frames } = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result;
  for (const name of ["sandboxed", "data"]) {
    const info = frames.find((x) => x.name === name);
    assert.equal(info.evaluable, false);
    const refused = await f.evaluate("return 1;", { frameId: info.frameId });
    assert.equal(refused.error.code, "UNSUPPORTED_TARGET");
    assert.equal(refused.error.effect, "none");
  }
  assert.ok(f.wc.allFrames().every((fr) => fr.executed.length === 0));
});

test("a frame that navigated, was removed, or whose id is guessed/foreign is STALE_FRAME with effect none and no delivery", async () => {
  const f = await setup();
  const one = f.wc.addFrame({ url: "https://other.example/1", name: "dup" });
  const two = f.wc.addFrame({ url: "https://other.example/1", name: "dup" });
  const { frames } = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result;
  const [id1, id2] = frames.filter((x) => x.name === "dup").map((x) => x.frameId);
  one.navigate("https://other.example/1"); // reload, same URL
  const reloaded = await f.evaluate("return 1;", { frameId: id1 });
  assert.equal(reloaded.error.code, "STALE_FRAME");
  assert.equal(reloaded.error.effect, "none");
  assert.equal(programRuns(one), 0);
  f.wc.frameList.splice(f.wc.frameList.indexOf(two), 1);
  assert.equal((await f.evaluate("return 1;", { frameId: id2 })).error.code, "STALE_FRAME");
  for (const guess of ["main", "f1", "other.example"]) assert.equal((await f.evaluate("return 1;", { frameId: guess })).error.code, "STALE_FRAME");
  // a frame id from another controller/view never resolves here
  const g = await setup();
  g.wc.addFrame({ url: "https://other.example/1", name: "x" });
  const foreign = (await g.controller.snapshot(g.a.handle, { leaseId: g.lease })).result.frames[1].frameId;
  assert.equal((await f.evaluate("return 1;", { frameId: foreign })).error.code, "STALE_FRAME");
  assert.equal(programRuns(two), 0);
});

test("top-document navigation invalidates frame ids and the documentEpoch", async () => {
  const f = await setup();
  f.wc.addFrame({ url: "https://other.example/1", name: "c" });
  const { frames } = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result;
  const id = frames[1].frameId;
  const epoch = f.epoch();
  await f.controller.navigate(f.a.handle, { leaseId: f.lease, url: "https://example.com/other" });
  assert.equal((await f.controller.evaluate(f.a.handle, { leaseId: f.lease, documentEpoch: f.epoch(), script: "return 1;", frameId: id })).error.code, "STALE_FRAME");
  assert.equal((await f.controller.evaluate(f.a.handle, { leaseId: f.lease, documentEpoch: epoch, script: "return 1;" })).error.code, "STALE_DOCUMENT");
});

test("RACE: a navigation that starts while the token step is in flight never receives the script", async () => {
  const f = await setup();
  const child = f.wc.addFrame({ url: "https://other.example/1", name: "c", processId: 2 });
  const id = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result.frames[1].frameId;
  child.exec = async (code, run) => {
    child.navigate("https://other.example/NEW"); // starts + commits while the exec is "in flight"
    return run(); // the exec lands in the NEW document (as observed in real Electron)
  };
  const result = await f.evaluate("globalThis.ran = true; return 1;", { frameId: id });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "STALE_FRAME");
  assert.equal(result.error.effect, "none");
  assert.equal(programRuns(child), 0, "the program was never sent");
  assert.equal(child.page.ran, undefined);
});

test("RACE: a navigation between token step and delivery is caught by the in-page guard (script does not run, effect none)", async () => {
  const f = await setup();
  const child = f.wc.addFrame({ url: "https://other.example/1", name: "c", processId: 2 });
  const id = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result.frames[1].frameId;
  child.exec = async (code, run) => {
    if (!isProgram(code)) return run();
    // Chromium accepted the program, then the document was replaced before it ran: it lands in the NEW world.
    child.page = (child.newPage(), child.page);
    child.routingId += 1;
    return run();
  };
  const result = await f.evaluate("globalThis.ran = true; return 1;", { frameId: id });
  assert.equal(result.ok, false);
  assert.ok(["STALE_FRAME", "STALE_DOCUMENT"].includes(result.error.code), result.error.code);
  assert.equal(result.error.effect, "none", "the guard proves the script never started");
  assert.equal(child.page.ran, undefined);
});

test("RACE (main frame): top navigation between validation and delivery cannot run the script in the new page", async () => {
  const f = await setup();
  f.main.exec = async (code, run) => {
    if (!isProgram(code)) return run();
    f.wc.url = "https://example.com/next";
    f.main.navigate("https://example.com/next"); // top navigation starts+commits; the delivered exec lands in the NEW page
    f.wc.emit("did-navigate", {}, f.wc.url, 200, "OK");
    return run();
  };
  const result = await f.evaluate("globalThis.ran = true; return 1;");
  assert.equal(result.ok, false);
  assert.equal(f.main.page.ran, undefined);
});

test("finished script but the page navigated meanwhile: STALE_* with effect possible (result not returned)", async () => {
  const f = await setup();
  f.main.exec = async (code, run) => {
    const value = await run();
    if (isProgram(code)) f.main.navigate("https://example.com/after");
    return value;
  };
  const result = await f.evaluate("return 'done';");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "STALE_DOCUMENT");
  assert.equal(result.error.effect, "possible");
  assert.equal(result.error.retryable, false);
});

test("TIMEOUT after delivery (script never returns, e.g. a synchronous infinite loop): effect possible, view closed, lease gone, host fine", async () => {
  const f = await setup();
  f.wc.destroyDelayMs = 150;
  f.main.exec = (code, run) => (isProgram(code) ? new Promise(() => {}) : run());
  const started = Date.now();
  const result = await f.evaluate("while (true) {}", { timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TIMEOUT");
  assert.equal(result.error.effect, "possible");
  assert.equal(result.error.retryable, false);
  assert.ok(Date.now() - started < 2000, "returns at the Main deadline, not when the page finishes");
  assert.deepEqual(f.wc.closeOptions, { waitForBeforeUnload: false });
  assert.equal(f.host.attached.size, 0, "view detached");
  assert.equal(f.controller.ownership.getOwner().kind, "none", "lease expired");
  assert.ok(f.controller.getState().error);
  // destruction not confirmed yet: no new view, BROWSER_UNAVAILABLE
  const b = f.issue("B");
  const early = await f.controller.acquire(b.handle, { url: URL1 });
  assert.equal(early.error.code, "BROWSER_UNAVAILABLE");
  assert.equal(f.host.views.length, 1, "no replacement view was created");
  await sleep(300);
  const later = await f.controller.acquire(f.issue("B2").handle, { url: URL1 });
  assert.equal(later.ok, true, JSON.stringify(later));
  assert.equal(f.host.views.length, 2);
  // the old lease/frame ids are dead
  assert.ok(["LEASE_EXPIRED", "BROWSER_NOT_OWNED", "CANCELLED"].includes((await f.controller.evaluate(f.a.handle, { leaseId: f.lease, documentEpoch: 0, script: "return 1;" })).error.code));
});

test("a late resolve/reject of the abandoned execution never produces a success or an unhandled rejection", async () => {
  const f = await setup();
  let release;
  f.main.exec = (code, run) => (isProgram(code) ? new Promise((resolve) => { release = () => resolve(JSON.stringify({ kind: "ok", json: "1" })); }) : run());
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const result = await f.evaluate("return 1;", { timeoutMs: 150 });
  assert.equal(result.error.code, "TIMEOUT");
  release();
  await sleep(50);
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
});

test("timeout BEFORE delivery (queued behind a slow operation): no script is sent and the view is NOT abandoned", async () => {
  const f = await setup();
  f.wc.pageHandlers.hasText = () => new Promise(() => {}); // a wait() that holds the serial queue
  const hold = f.controller.wait(f.a.handle, { leaseId: f.lease, timeoutMs: 400, condition: { kind: "text", text: "x", present: true } });
  await sleep(30);
  const result = await f.evaluate("return 1;", { timeoutMs: 150 });
  assert.equal(result.error.code, "TIMEOUT");
  assert.equal(result.error.effect, "none");
  assert.equal(f.main.executed.length, 0);
  assert.equal(f.wc.calls.includes("close"), false);
  await hold;
});

test("the deadline covers panel wait + queue + run as a whole (not a fresh budget per stage)", async () => {
  const f = await setup();
  f.main.exec = (code, run) => (isProgram(code) ? new Promise(() => {}) : sleep(120).then(run)); // token step eats 120ms
  const started = Date.now();
  const result = await f.evaluate("return 1;", { timeoutMs: 300 });
  const took = Date.now() - started;
  assert.equal(result.error.code, "TIMEOUT");
  assert.ok(took < 450, `took ${took}ms`);
});

test("cancelling a delivered evaluate (run aborted) reports CANCELLED effect possible and closes the view; later operations are not blocked", async () => {
  const f = await setup();
  f.main.exec = (code, run) => (isProgram(code) ? new Promise(() => {}) : run());
  const pending = f.evaluate("await new Promise(() => {});", { timeoutMs: 30000 });
  await sleep(80);
  f.a.abort.abort();
  const result = await pending;
  assert.equal(result.error.code, "CANCELLED");
  assert.equal(result.error.effect, "possible");
  assert.equal(f.wc.calls.includes("close"), true);
  const next = f.issue("C");
  const again = await f.controller.acquire(next.handle, { url: URL1 });
  assert.equal(again.ok, true, "the queue recovered and a new view can be acquired");
});

test("user takeover during a delivered evaluate: USER_INTERRUPTED effect possible, view closed", async () => {
  const f = await setup();
  f.main.exec = (code, run) => (isProgram(code) ? new Promise(() => {}) : run());
  const pending = f.evaluate("while(true){}", { timeoutMs: 30000 });
  await sleep(80);
  f.controller.takeControl();
  const result = await pending;
  assert.equal(result.error.code, "USER_INTERRUPTED");
  assert.equal(result.error.effect, "possible");
  assert.equal(f.wc.calls.includes("close"), true);
});

test("modal / resize / panel close / window hide during a delivered evaluate end it with effect possible and close the view", async () => {
  const cases = {
    modal: (f) => f.controller.setPresentation({ open: true, occluded: true, resizing: false }),
    resize: (f) => f.controller.setPresentation({ open: true, occluded: false, resizing: true }),
    close: (f) => f.controller.setPresentation({ open: false, occluded: false, resizing: false }),
    hide: (f) => f.controller.onWindowHidden()
  };
  for (const [name, trigger] of Object.entries(cases)) {
    const f = await setup();
    f.main.exec = (code, run) => (isProgram(code) ? new Promise(() => {}) : run());
    const pending = f.evaluate("await new Promise(() => {});", { timeoutMs: 30000 });
    await sleep(80);
    trigger(f);
    const result = await pending;
    assert.equal(result.ok, false, name);
    assert.equal(result.error.effect, "possible", `${name}: ${result.error.code}`);
    assert.equal(result.error.retryable, false, name);
    assert.equal(f.wc.calls.includes("close"), true, name);
  }
});

test("turning evaluate OFF during a delivered evaluate stops it (EVALUATE_DISABLED/CANCELLED, effect possible)", async () => {
  const f = await setup();
  f.main.exec = (code, run) => (isProgram(code) ? new Promise(() => {}) : run());
  const pending = f.evaluate("await new Promise(() => {});", { timeoutMs: 30000 });
  await sleep(80);
  await f.controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.effect, "possible");
});

test("evaluate OFF closes a view in which scripts ran (page may keep timers) but keeps one that never ran scripts; sessions are not cleared", async () => {
  const ran = await setup();
  assert.equal((await ran.evaluate("return 1;")).ok, true);
  const policy = ran.controller.getPolicyRevision();
  await ran.controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false });
  assert.equal(ran.wc.calls.includes("close"), true, "scripted view closed");
  assert.equal(ran.host.cleared, 0, "cookies/storage untouched");
  assert.ok(ran.controller.getPolicyRevision() > policy);
  assert.equal(ran.controller.isEvaluateEnabled(), false);
  assert.equal(ran.controller.status().result.evaluateEnabled, false);

  const clean = await setup();
  await clean.controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false });
  assert.equal(clean.wc.calls.includes("close"), false, "no script ever ran here");
  assert.equal(clean.host.cleared, 0);
  // issuing resumes after an evaluate-only change (prepare() had stopped it)
  clean.controller.ownership.setIssuing(false);
  await clean.controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: true });
  assert.doesNotThrow(() => clean.controller.issueRun({ conversationId: "Z", requestId: "z", policyRevision: 1 }));
  assert.equal(clean.controller.isEvaluateEnabled(), true);
});

test("a view that already hosted a script is not mistaken for a clean one after a replacement view is created", async () => {
  const f = await setup();
  assert.equal((await f.evaluate("return 1;")).ok, true);
  await f.controller.release(f.a.handle, { leaseId: f.lease });
  const b = f.issue("B");
  const second = await f.controller.acquire(b.handle, { url: "https://example.com/b" });
  assert.equal(second.ok, true);
  const view2 = f.host.views[1].webContents;
  await f.controller.applySettings({ enabled: true, autoOpenOnToolUse: true, evaluateEnabled: false });
  assert.equal(view2.calls.includes("close"), false, "the new view never ran a script");
});

test("evaluate operations are serialized in the queue and never overlap", async () => {
  const f = await setup();
  let active = 0;
  let maxActive = 0;
  f.main.exec = async (code, run) => {
    if (!isProgram(code)) return run();
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(40);
    active -= 1;
    return run();
  };
  const results = await Promise.all([f.evaluate("return 1;"), f.evaluate("return 2;"), f.evaluate("return 3;")]);
  assert.deepEqual(results.map((r) => r.result?.value?.value), [1, 2, 3]);
  assert.equal(maxActive, 1);
});

test("an exec that fails because the frame was disposed mid-flight is STALE_FRAME/PAGE-level with effect possible and does not close the view", async () => {
  const f = await setup();
  const child = f.wc.addFrame({ url: "https://other.example/1", name: "c" });
  const id = (await f.controller.snapshot(f.a.handle, { leaseId: f.lease })).result.frames[1].frameId;
  child.exec = async (code, run) => {
    if (isProgram(code)) throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    return run();
  };
  const result = await f.evaluate("return 1;", { frameId: id });
  assert.equal(result.error.code, "STALE_FRAME");
  assert.equal(result.error.effect, "possible");
  assert.equal(f.wc.calls.includes("close"), false);
});

test("logging contract: script text is never stored in controller state or errors", async () => {
  const f = await setup();
  const secret = "SECRET-SCRIPT-TEXT-123";
  const result = await f.evaluate(`const x = '${secret}'; throw new Error('boom');`);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(f.controller.getState()).includes(secret), false);
  assert.equal(JSON.stringify(f.host.sent).includes(secret), false);
});
