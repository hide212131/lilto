const test = require("node:test");
const assert = require("node:assert/strict");
const { EmbeddedBrowserController } = require("../dist/main/embedded-browser.js");
const { FakeHost, presentPanel } = require("./helpers/browser-fakes.js");

function setup(settings = { enabled: true, autoOpenOnToolUse: true }) {
  const host = new FakeHost();
  const controller = new EmbeddedBrowserController(host, settings);
  controller.beginRendererEpoch();
  const issue = (conversationId) => {
    const ctx = controller.issueRun({ conversationId, requestId: `req-${conversationId}`, policyRevision: 1 });
    const abort = new AbortController();
    return { ctx, handle: { runId: ctx.runId, conversationId, signal: AbortSignal.any([abort.signal, controller.ownership.resolveToken(ctx.token).signal]) }, abort };
  };
  return { host, controller, issue };
}

/** Make the view visible as soon as it exists (simulates the renderer answering an auto-open). */
function autoRenderer(controller) {
  // One answer per layout request or panel-open request (like the real renderer): a blocked environment must not loop forever.
  let prev = { requested: false, layoutRevision: -1, epoch: "" };
  return controller.onState((state) => {
    const asked = (state.panelRequested && !prev.requested) || state.layoutRevision !== prev.layoutRevision || state.rendererEpoch !== prev.epoch;
    prev = { requested: state.panelRequested, layoutRevision: state.layoutRevision, epoch: state.rendererEpoch };
    if (state.panelRequested && !state.operationReady && asked) setImmediate(() => presentPanel(controller));
  });
}

const URL1 = "https://example.com/a";

test("acquire opens the panel (auto-open), loads the URL and returns a lease", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const { handle } = issue("A");
  const result = await controller.acquire(handle, { url: URL1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.result.leaseId);
  assert.equal(result.state.url, URL1);
  assert.equal(result.state.panelVisible, true);
  assert.equal(host.views.length, 1);
  assert.equal(host.views[0].visible, true);
  assert.deepEqual(host.views[0].bounds, { x: 700, y: 50, width: 480, height: 700 });
});

test("autoOpenOnToolUse OFF: acquire fails with PANEL_CLOSED and leaves no lease", async () => {
  const { controller, issue } = setup({ enabled: true, autoOpenOnToolUse: false });
  const { handle } = issue("A");
  const result = await controller.acquire(handle, { url: URL1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PANEL_CLOSED");
  assert.equal(controller.ownership.getOwner().kind, "none");
  assert.equal(controller.getState().panelRequested, false);
});

test("an explicitly hidden window rejects acquire and does not operate in the background", async () => {
  const { controller, issue, host } = setup();
  host.windowVisible = false;
  const result = await controller.acquire(issue("A").handle, { url: URL1 });
  assert.equal(result.error.code, "BROWSER_UNAVAILABLE");
  assert.equal(host.views.length, 0);
});

test("non-http(s) and credentialed URLs are blocked before any view is touched", async () => {
  const { controller, issue, host } = setup();
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "https://u:p@example.com/", "about:blank"]) {
    const result = await controller.acquire(issue("A").handle, { url });
    assert.equal(result.error.code, "NAVIGATION_BLOCKED", url);
  }
  assert.equal(host.views.length, 0);
});

test("A/B conflict: B gets BROWSER_BUSY and A keeps its lease; status never leaks ids", async () => {
  const { controller, issue } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const b = issue("B");
  const first = await controller.acquire(a.handle, { url: URL1 });
  const second = await controller.acquire(b.handle, { url: URL1 });
  assert.equal(second.error.code, "BROWSER_BUSY");
  const status = controller.status();
  assert.deepEqual(status.result.owner, { kind: "agent", conversationId: "A" });
  assert.equal(JSON.stringify(status).includes(first.result.leaseId), false);
  assert.equal(JSON.stringify(controller.getState()).includes(first.result.leaseId), false);
  const snap = await controller.getText(a.handle, { leaseId: first.result.leaseId });
  assert.notEqual(snap.error?.code, "BROWSER_BUSY");
});

test("different conversation acquiring later gets a brand new view (no history/DOM carry-over)", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = await controller.acquire(a.handle, { url: URL1 });
  await controller.release(a.handle, { leaseId: lease.result.leaseId });
  const b = issue("B");
  const second = await controller.acquire(b.handle, { url: "https://example.com/b" });
  assert.equal(second.ok, true);
  assert.equal(host.views.length, 2);
  assert.equal(host.views[0].webContents.destroyed, true);
  assert.equal(host.attached.size, 1);
});

test("user manual takeover: lease expires, input is not delivered afterwards, run cannot reacquire", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.prepareClick = async () => ({ ok: true, x: 100, y: 100 });
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  controller.takeControl();
  const click = await controller.click(a.handle, { leaseId: lease, snapshotId, ref: "r" });
  assert.equal(click.ok, false);
  assert.equal(click.error.code, "USER_INTERRUPTED");
  assert.equal(wc.inputs.length, 0);
  const again = await controller.acquire(a.handle, { url: URL1 });
  assert.equal(again.error.code, "USER_INTERRUPTED");
});

async function takeSnapshot(controller, handle, leaseId, wc) {
  wc.pageHandlers.snapshot = async (args) => ({ ok: true, snapshot: { format: "dom-v1", snapshotId: args.snapshotId, documentEpoch: args.documentEpoch, viewport: { width: 480, height: 700 }, nodes: [], text: "", truncated: false, limitations: [] } });
  const snap = await controller.snapshot(handle, { leaseId });
  assert.equal(snap.ok, true, JSON.stringify(snap));
  return snap.result.snapshotId;
}

test("snapshot ids go stale on navigation, ownership change, and expiry", async () => {
  let clock = 1_000_000;
  const host = new FakeHost();
  const controller = new EmbeddedBrowserController(host, { enabled: true, autoOpenOnToolUse: true }, () => clock);
  controller.beginRendererEpoch();
  autoRenderer(controller);
  const ctx = controller.issueRun({ conversationId: "A", requestId: "r", policyRevision: 1 });
  const handle = { runId: ctx.runId, conversationId: "A", signal: controller.ownership.resolveToken(ctx.token).signal };
  const lease = (await controller.acquire(handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.getText = async () => ({ ok: true, text: "x", truncated: false });
  let snapshotId = await takeSnapshot(controller, handle, lease, wc);
  assert.equal((await controller.getText(handle, { leaseId: lease, snapshotId, ref: "r" })).ok, true);
  clock += 61_000;
  assert.equal((await controller.getText(handle, { leaseId: lease, snapshotId, ref: "r" })).error.code, "STALE_REF");
  snapshotId = await takeSnapshot(controller, handle, lease, wc);
  wc.emit("did-navigate-in-page", {}, "https://example.com/a#x", true);
  assert.equal((await controller.getText(handle, { leaseId: lease, snapshotId, ref: "r" })).error.code, "STALE_REF");
  snapshotId = await takeSnapshot(controller, handle, lease, wc);
  wc.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  assert.equal((await controller.getText(handle, { leaseId: lease, snapshotId, ref: "r" })).error.code, "STALE_REF");
  snapshotId = await takeSnapshot(controller, handle, lease, wc);
  assert.equal((await controller.getText(handle, { leaseId: "bogus", snapshotId, ref: "r" })).error.code, "LEASE_EXPIRED");
});

test("modal (occlusion) cancels the in-flight wait and blocks new operations until re-presented", async () => {
  const { controller, issue, host } = setup();
  const stopRenderer = autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.hasText = async () => ({ ok: true, present: false });
  const pending = controller.wait(a.handle, { leaseId: lease, timeoutMs: 5000, condition: { kind: "text", text: "never", present: true } });
  await new Promise((r) => setTimeout(r, 30));
  stopRenderer(); // a real renderer would keep reporting occluded: true while the dialog is open
  controller.setPresentation({ open: true, occluded: true, resizing: false });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PANEL_OCCLUDED");
  assert.equal(host.views[0].visible, false);
  const blocked = await controller.getText(a.handle, { leaseId: lease });
  assert.equal(blocked.error.code, "PANEL_OCCLUDED");
});

test("closing the panel expires the lease, the run is interrupted, and auto-open does not reopen it", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  controller.setPresentation({ open: false, occluded: false, resizing: false });
  assert.equal(controller.getState().panelRequested, false);
  assert.equal(host.views[0].visible, false);
  const result = await controller.getText(a.handle, { leaseId: lease });
  assert.equal(result.error.code, "USER_INTERRUPTED");
});

test("window hidden expires the lease without forbidding a later reacquire by the same run", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  host.windowVisible = false;
  controller.onWindowHidden();
  assert.equal((await controller.getText(a.handle, { leaseId: lease })).ok, false);
  host.windowVisible = true;
  controller.onWindowShown();
  const again = await controller.acquire(a.handle, { url: URL1 });
  assert.equal(again.ok, true, JSON.stringify(again));
});

test("run revocation cancels a pending operation (late result discarded)", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.hasText = async () => ({ ok: true, present: false });
  const pending = controller.wait(a.handle, { leaseId: lease, timeoutMs: 5000, condition: { kind: "text", text: "x", present: true } });
  await new Promise((r) => setTimeout(r, 30));
  controller.ownership.revokeRun(a.handle.runId);
  const result = await pending;
  assert.equal(result.error.code, "CANCELLED");
});

test("wait times out with TIMEOUT and never polls forever", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  host.views[0].webContents.pageHandlers.hasText = async () => ({ ok: true, present: false });
  const started = Date.now();
  const result = await controller.wait(a.handle, { leaseId: lease, timeoutMs: 300, condition: { kind: "text", text: "x", present: true } });
  assert.equal(result.error.code, "TIMEOUT");
  assert.ok(Date.now() - started < 2000);
});

test("click sends mouseMove/Down/Up, registers them as expected input, and reports effect possible on later failure", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.prepareClick = async () => ({ ok: true, x: 120.4, y: 80.6 });
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  const result = await controller.click(a.handle, { leaseId: lease, snapshotId, ref: "r" });
  assert.equal(result.ok, true);
  assert.deepEqual(wc.inputs.map((i) => i.type), ["mouseMove", "mouseDown", "mouseUp"]);
  assert.equal(wc.inputs[1].x, 120);
  // Planned input must not interrupt the agent...
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  wc.emit("before-mouse-event", event, { type: "mouseDown", x: 120, y: 81 });
  assert.equal(event.prevented, false);
  assert.equal(controller.ownership.getOwner().kind, "agent");
});

test("unplanned user mouse/keyboard input during an agent lease is blocked and takes over", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  wc.emit("before-mouse-event", event, { type: "mouseDown", x: 5, y: 5 });
  assert.equal(event.prevented, true);
  assert.deepEqual(controller.ownership.ownerView(), { kind: "user" });
  assert.equal(controller.getState().error.includes("手動操作"), true);
  const keyEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  wc.emit("before-input-event", keyEvent, { type: "keyDown", key: "a" });
  assert.equal(keyEvent.prevented, false, "no agent lease anymore, so user typing passes through");
  assert.equal((await controller.getText(a.handle, { leaseId: lease })).error.code, "USER_INTERRUPTED");
});

test("input is delivered while the window is unfocused (OS focus is not an operation condition)", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.prepareClick = async () => ({ ok: true, x: 1, y: 1 });
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  host.windowFocused = false;
  const result = await controller.click(a.handle, { leaseId: lease, snapshotId, ref: "r" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(wc.inputs.some((e) => e.type === "mouseDown"));
});

test("fill uses insertText (no per-key events) and verifies the resulting value; mismatch reports applied effect", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.prepareFill = async () => ({ ok: true, empty: true });
  wc.pageHandlers.verifyFill = async () => ({ ok: true, matches: true, focused: true });
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  const ok = await controller.fill(a.handle, { leaseId: lease, snapshotId, ref: "r", text: "こんにちは" });
  assert.equal(ok.ok, true);
  assert.deepEqual(wc.inputs, [{ type: "insertText", text: "こんにちは" }]);
  wc.pageHandlers.verifyFill = async () => ({ ok: true, matches: false, focused: true });
  const bad = await controller.fill(a.handle, { leaseId: lease, snapshotId, ref: "r", text: "x" });
  assert.equal(bad.error.effect, "applied");
});

test("fill with empty text on a non-empty field sends Delete; on an empty field sends nothing", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.verifyFill = async () => ({ ok: true, matches: true, focused: true });
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  wc.pageHandlers.prepareFill = async () => ({ ok: true, empty: false });
  await controller.fill(a.handle, { leaseId: lease, snapshotId, ref: "r", text: "" });
  assert.deepEqual(wc.inputs.map((i) => i.type), ["keyDown", "keyUp"]);
  wc.inputs.length = 0;
  wc.pageHandlers.prepareFill = async () => ({ ok: true, empty: true });
  await controller.fill(a.handle, { leaseId: lease, snapshotId, ref: "r", text: "" });
  assert.equal(wc.inputs.length, 0);
});

test("page runtime errors (covered element etc.) surface with their code and send no input", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.prepareClick = async () => ({ ok: false, code: "ELEMENT_NOT_INTERACTABLE", message: "covered" });
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  const result = await controller.click(a.handle, { leaseId: lease, snapshotId, ref: "r" });
  assert.equal(result.error.code, "ELEMENT_NOT_INTERACTABLE");
  assert.equal(wc.inputs.length, 0);
});

test("operations are never retried automatically", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  let calls = 0;
  wc.pageHandlers.prepareClick = async () => { calls += 1; return { ok: false, code: "STALE_REF", message: "x" }; };
  const snapshotId = await takeSnapshot(controller, a.handle, lease, wc);
  await controller.click(a.handle, { leaseId: lease, snapshotId, ref: "r" });
  assert.equal(calls, 1);
});

test("screenshot downsizes to <=1280 edge and enforces the 1 MiB cap", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  const shot = await controller.screenshot(a.handle, { leaseId: lease });
  assert.equal(shot.ok, true);
  assert.equal(shot.result.width, 1280);
  assert.equal(shot.result.height, 640);
  assert.equal(shot.result.mimeType, "image/png");
  assert.equal(Buffer.from(shot.result.imageBase64, "base64").length, 1000);
  wc.shot = { width: 800, height: 600, bytes: 1024 * 1024 + 1 };
  const big = await controller.screenshot(a.handle, { leaseId: lease });
  assert.equal(big.error.code, "RESULT_TOO_LARGE");
});

test("navigation failure reports NAVIGATION_FAILED and releases the orphan lease on acquire", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const first = await controller.acquire(a.handle, { url: URL1 });
  await controller.release(a.handle, { leaseId: first.result.leaseId });
  host.views[0].webContents.loadBehavior = () => ({ fail: true });
  const b = issue("A");
  const failed = await controller.acquire(b.handle, { url: "https://nope.invalid/" });
  assert.equal(failed.error.code, "NAVIGATION_FAILED");
  assert.equal(controller.ownership.getOwner().kind, "none");
  assert.match(controller.getState().error, /読み込みに失敗/);
});

test("navigate while holding the lease; ERR_ABORTED-style supersession is not a failure; hang times out", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const nav = await controller.navigate(a.handle, { leaseId: lease, url: "https://example.com/next", waitUntil: "domcontentloaded" });
  assert.equal(nav.ok, true);
  assert.equal(nav.result.finalUrl, "https://example.com/next");
  assert.equal(nav.result.httpStatus, 200);
  host.views[0].webContents.loadBehavior = () => ({ hang: true });
  const slow = await controller.navigate(a.handle, { leaseId: lease, url: "https://example.com/slow", timeoutMs: 200 });
  assert.equal(slow.error.code, "TIMEOUT");
  assert.equal(slow.error.effect, "possible");
});

test("view blocks non-http navigations, denies popups, loads http popups in the same surface", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  await controller.acquire(a.handle, { url: URL1 });
  const wc = host.views[0].webContents;
  for (const target of ["file:///etc/passwd", "javascript:1", "data:text/html,x", "blob:https://x/1", "ftp://x/"]) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    wc.emit("will-navigate", event, target);
    assert.equal(event.prevented, true, target);
    const redirect = { prevented: false, preventDefault() { this.prevented = true; } };
    wc.emit("will-redirect", redirect, target);
    assert.equal(redirect.prevented, true, target);
  }
  const ok = { prevented: false, preventDefault() { this.prevented = true; } };
  wc.emit("will-navigate", ok, "https://example.com/ok");
  assert.equal(ok.prevented, false);
  assert.deepEqual(wc.windowOpenHandler({ url: "javascript:1" }), { action: "deny" });
  assert.deepEqual(wc.windowOpenHandler({ url: "https://example.com/popup" }), { action: "deny" });
  await new Promise((r) => setImmediate(r));
  assert.ok(wc.calls.includes("loadURL:https://example.com/popup"));
  assert.equal(host.views.length, 1, "no extra surfaces created");
});

test("render-process-gone expires the lease, shows an error, and does not auto-replay", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  host.views[0].webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(controller.getState().error, "ページが停止しました");
  assert.equal(controller.ownership.getOwner().kind, "none");
  assert.equal((await controller.getText(a.handle, { leaseId: lease })).ok, false);
});

test("user navigation expires an agent lease first, then loads; typed URLs must be full http(s)", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  await controller.navigateByUser("example.org");
  assert.match(controller.getState().error, /http\(s\)/);
  assert.equal(controller.ownership.getOwner().kind, "agent");
  await controller.navigateByUser("https://example.org/");
  assert.equal(controller.ownership.getOwner().kind, "none");
  assert.equal(host.views[0].webContents.getURL(), "https://example.org/");
  assert.equal((await controller.getText(a.handle, { leaseId: lease })).error.code, "USER_INTERRUPTED");
});

test("link clicks with the browser OFF open externally and create no view; non-http is ignored", async () => {
  const { controller, host } = setup({ enabled: false, autoOpenOnToolUse: true });
  await controller.navigateByUser("https://example.com/x");
  await controller.navigateByUser("javascript:alert(1)");
  assert.deepEqual(host.external, ["https://example.com/x"]);
  assert.equal(host.views.length, 0);
});

test("settings OFF: revokes runs/leases, aborts waits, closes the view, clears session, refuses new runs and tool calls", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  wc.pageHandlers.hasText = async () => ({ ok: true, present: false });
  const pending = controller.wait(a.handle, { leaseId: lease, timeoutMs: 5000, condition: { kind: "text", text: "x", present: true } });
  await new Promise((r) => setTimeout(r, 30));
  await controller.applySettings({ enabled: false, autoOpenOnToolUse: true });
  assert.equal((await pending).ok, false);
  assert.equal(wc.destroyed, true);
  assert.equal(host.cleared, 1);
  assert.equal(host.attached.size, 0);
  assert.equal(controller.ownership.getOwner().kind, "none");
  assert.throws(() => controller.issueRun({ conversationId: "A", requestId: "r", policyRevision: 1 }), { code: "BROWSER_DISABLED" });
  assert.equal((await controller.acquire(a.handle, { url: URL1 })).error.code, "BROWSER_DISABLED");
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: true });
  const fresh = issue("A");
  assert.equal((await controller.acquire(fresh.handle, { url: URL1 })).ok, true);
});

test("autoOpenOnToolUse change alone does not revoke runs", async () => {
  const { controller, issue } = setup();
  autoRenderer(controller);
  const a = issue("A");
  await controller.acquire(a.handle, { url: URL1 });
  await controller.applySettings({ enabled: true, autoOpenOnToolUse: false });
  assert.equal(controller.ownership.getOwner().kind, "agent");
  assert.equal(controller.getState().autoOpenOnToolUse, false);
});

test("viewport updates from stale epochs or revisions are ignored; relayout hides the view until re-measured", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  await controller.acquire(issue("A").handle, { url: URL1 });
  const view = host.views[0];
  assert.equal(view.visible, true);
  controller.onWindowGeometryChanged();
  assert.equal(view.visible, false);
  const stale = controller.updateViewport({ rendererEpoch: "old", seq: 999, layoutRevision: 99, viewport: { x: 1, y: 1, width: 100, height: 100 }, hostViewport: { width: 1200, height: 800 }, panelOpen: true, occluded: false, resizing: false });
  assert.equal(stale, false);
  assert.equal(view.visible, false);
  presentPanel(controller);
  assert.equal(view.visible, true);
});

test("zoom factor scales CSS px to DIP and results are clamped to the window", async () => {
  const { controller, issue, host } = setup();
  host.zoom = 1.25;
  autoRenderer(controller);
  await controller.acquire(issue("A").handle, { url: URL1 });
  assert.deepEqual(host.views[0].bounds, { x: 875, y: 63, width: 325, height: 737 });
});

test("state notifications carry no tokens or lease ids and only increase revision", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const revisions = host.sent.filter((m) => m.channel === "browser:stateChanged").map((m) => m.payload.revision);
  assert.deepEqual(revisions, [...revisions].sort((x, y) => x - y));
  const blob = JSON.stringify(host.sent);
  assert.equal(blob.includes(lease), false);
  assert.equal(blob.includes(a.ctx.token), false);
});

test("queue serializes operations: a second operation waits for the first", async () => {
  const { controller, issue, host } = setup();
  autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  const wc = host.views[0].webContents;
  const order = [];
  wc.pageHandlers.getText = async () => { order.push("start"); await new Promise((r) => setTimeout(r, 30)); order.push("end"); return { ok: true, text: "t", truncated: false }; };
  const [r1, r2] = await Promise.all([controller.getText(a.handle, { leaseId: lease }), controller.getText(a.handle, { leaseId: lease })]);
  assert.equal(r1.ok && r2.ok, true);
  assert.deepEqual(order, ["start", "end", "start", "end"]);
});

test("closing via a viewport message (racing the presentation message) still expires the lease and never auto-reopens", async () => {
  const { controller, issue, host } = setup();
  const stop = autoRenderer(controller);
  const a = issue("A");
  const lease = (await controller.acquire(a.handle, { url: URL1 })).result.leaseId;
  stop();
  presentPanel(controller, { panelOpen: false });
  assert.equal(controller.getState().panelRequested, false);
  assert.equal(controller.ownership.getOwner().kind, "none");
  assert.equal(host.views[0].visible, false);
  const result = await controller.getText(a.handle, { leaseId: lease });
  assert.equal(result.error.code, "USER_INTERRUPTED");
  // A later run with auto-open ON may open the panel again, but only for a *new* acquire.
  autoRenderer(controller);
  const fresh = issue("A");
  assert.equal((await controller.acquire(fresh.handle, { url: URL1 })).ok, true);
});

/* ---- Issue #42: minimized / unfocused / covered windows keep working ---- */

async function acquired(settings) {
  const f = setup(settings);
  autoRenderer(f.controller);
  const a = f.issue("A");
  const result = await f.controller.acquire(a.handle, { url: URL1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  const wc = f.host.views[0].webContents;
  wc.pageHandlers.getText = async () => ({ ok: true, text: "t", truncated: false });
  return { ...f, a, lease: result.result.leaseId, wc };
}

test("minimize keeps the lease, the native view and the layout; panelVisible=false while operationReady=true", async () => {
  const f = await acquired();
  const before = f.controller.ownership.snapshotEpochs();
  f.host.minimize();
  f.controller.onWindowMinimized();
  const state = f.controller.getState();
  assert.equal(state.panelVisible, false);
  assert.equal(state.operationReady, true);
  assert.equal(state.windowMinimized, true);
  assert.equal(f.host.views[0].visible, true, "the native view stays displayed (the parent window is minimized)");
  assert.deepEqual(f.controller.ownership.snapshotEpochs(), before, "no epoch changes");
  assert.equal(f.controller.ownership.getOwner().kind, "agent");
  const snap = await takeSnapshot(f.controller, f.a.handle, f.lease, f.wc);
  assert.ok(snap);
  const text = await f.controller.getText(f.a.handle, { leaseId: f.lease });
  assert.equal(text.ok, true, JSON.stringify(text));
  assert.equal(text.state.panelVisible, false);
  assert.equal(text.state.operationReady, true);
  assert.equal(f.controller.status().result.available, true);
  assert.equal(f.controller.status().result.blockedReason, null);
  assert.equal(f.controller.status().result.operationReady, true);
});

test("minimized: click, fill, press, navigate and screenshot all work and send input without any focus", async () => {
  const f = await acquired();
  f.host.minimize(); f.host.windowFocused = false;
  f.controller.onWindowMinimized();
  f.wc.pageHandlers.prepareClick = async () => ({ ok: true, x: 3, y: 4 });
  f.wc.pageHandlers.prepareFill = async () => ({ ok: true, empty: true });
  f.wc.pageHandlers.verifyFill = async () => ({ ok: true, matches: true, focused: true });
  f.wc.pageHandlers.prepareFocus = async () => ({ ok: true });
  f.wc.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  const snapshotId = await takeSnapshot(f.controller, f.a.handle, f.lease, f.wc);
  assert.equal((await f.controller.click(f.a.handle, { leaseId: f.lease, snapshotId, ref: "r" })).ok, true);
  assert.equal((await f.controller.fill(f.a.handle, { leaseId: f.lease, snapshotId, ref: "r", text: "こんにちは" })).ok, true);
  assert.equal((await f.controller.press(f.a.handle, { leaseId: f.lease, snapshotId, ref: "r", key: "Enter" })).ok, true);
  assert.ok(f.wc.inputs.some((e) => e.type === "mouseDown") && f.wc.inputs.some((e) => e.type === "insertText") && f.wc.inputs.some((e) => e.type === "keyDown"));
  const nav = await f.controller.navigate(f.a.handle, { leaseId: f.lease, url: "https://example.com/b" });
  assert.equal(nav.ok, true, JSON.stringify(nav));
  assert.equal(nav.state.panelVisible, false);
  const shot = await f.controller.screenshot(f.a.handle, { leaseId: f.lease });
  assert.equal(shot.ok, true, JSON.stringify(shot));
  assert.deepEqual(f.wc.captureOptions, { stayHidden: true }, "capture the current surface without restoring the window");
  assert.ok(f.wc.calls.indexOf("page:settleFrames") >= 0 && f.wc.calls.indexOf("page:settleFrames") < f.wc.calls.length, "frames settle before capture");
});

test("minimized: another run still gets BROWSER_BUSY; restore keeps the same lease and the view", async () => {
  const f = await acquired();
  f.host.minimize();
  f.controller.onWindowMinimized();
  const busy = await f.controller.acquire(f.issue("B").handle, { url: URL1 });
  assert.equal(busy.error.code, "BROWSER_BUSY");
  f.host.restore();
  f.controller.onWindowRestored();
  assert.equal(f.controller.getState().panelVisible, true);
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease })).ok, true);
  assert.equal(f.controller.ownership.getOwner().kind, "agent");
});

test("restore with a changed window size re-measures: operations pause until the new layout arrives", async () => {
  const f = await acquired();
  f.host.minimize();
  f.controller.onWindowMinimized();
  f.host.content = { width: 900, height: 700 };
  f.host.restore();
  f.controller.onWindowRestored();
  assert.equal(f.controller.getState().operationReady, false);
  assert.equal(f.host.views[0].visible, false);
  presentPanel(f.controller);
  assert.equal(f.controller.getState().operationReady, true);
});

test("a resize event while minimized (platform shrink) does not discard the prepared surface", async () => {
  const f = await acquired();
  f.host.minimize();
  f.controller.onWindowMinimized();
  const revision = f.controller.getState().layoutRevision;
  f.controller.onWindowGeometryChanged();
  assert.equal(f.controller.getState().layoutRevision, revision);
  assert.equal(f.controller.getState().operationReady, true);
});

test("a collapsed viewport reported by a minimized window does not overwrite the valid surface", async () => {
  const f = await acquired();
  f.host.minimize();
  f.controller.onWindowMinimized();
  const bounds = { ...f.host.views[0].bounds };
  presentPanel(f.controller, { viewport: { x: 0, y: 0, width: 0, height: 0 }, hostViewport: { width: 0, height: 0 } });
  assert.deepEqual(f.host.views[0].bounds, bounds);
  assert.equal(f.controller.getState().operationReady, true);
});

test("minimized: first acquire auto-opens the panel logically and prepares an operable surface without restoring", async () => {
  const f = setup();
  f.host.minimize();
  autoRenderer(f.controller);
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.panelVisible, false);
  assert.equal(result.state.operationReady, true);
  assert.equal(f.host.windowMinimized, true, "the controller never restores the window");
  assert.equal(f.controller.getState().panelRequested, true);
});

test("minimized with autoOpen OFF and the panel closed: PANEL_CLOSED, nothing delivered", async () => {
  const f = setup({ enabled: true, autoOpenOnToolUse: false });
  f.host.minimize();
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1 });
  assert.equal(result.error.code, "PANEL_CLOSED");
  assert.equal(f.host.views.some((v) => v.webContents.calls.some((c) => c.startsWith("loadURL"))), false, "nothing was loaded");
});

test("minimized and the renderer never reports a layout: falls back to the host content area so the surface is still prepared (Issue #42 W1)", async () => {
  const f = setup();
  f.host.minimize();
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.operationReady, true);
  assert.equal(result.state.panelVisible, false);
  assert.equal(f.controller.ownership.getOwner().kind, "agent");
  assert.deepEqual(f.host.views[0].bounds, { x: 0, y: 0, width: f.host.content.width, height: f.host.content.height });
});

test("a real measurement while minimized with a collapsed host content size (observed on Windows) keeps the known-good surface instead of wiping it with a bad one (Issue #42 W1)", async () => {
  const f = await acquired();
  const bounds = { ...f.host.views[0].bounds };
  f.host.minimize();
  f.controller.onWindowMinimized();
  f.host.collapseContentWhenMinimized = true;
  // The renderer reports a normal, non-collapsed viewport; only the host's own content size has collapsed.
  presentPanel(f.controller);
  assert.equal(f.controller.getState().operationReady, true, "a bad measurement must not make a previously ready surface unready");
  assert.deepEqual(f.host.views[0].bounds, bounds, "the previous real measurement is kept, not nulled out by an unusable one");
});

test("minimized with a collapsed content size and no prior real measurement falls back to the normal (restored) bounds, not PANEL_NOT_READY (Issue #42 W1)", async () => {
  const f = setup();
  // A real, non-minimized content size is recorded first (like the window's normal measurement at startup).
  f.host.getContentSize();
  f.host.minimize();
  f.host.collapseContentWhenMinimized = true;
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.operationReady, true);
  assert.deepEqual(f.host.views[0].bounds, { x: 0, y: 0, width: f.host.normalContent.width, height: f.host.normalContent.height });
});

test("a true first-time minimize (nothing ever read the host content size before it) still falls back to normal bounds once primeChromeOffset ran at attach time (Issue #42 W3)", async () => {
  const f = setup();
  // Simulates attachControllerToWindow()'s eager call: the window exists and is not minimized yet,
  // but no tool has ever acquired/measured anything (the true cold-start repro).
  f.controller.primeChromeOffset();
  f.host.minimize();
  // Observed on Windows: the host's own content size also collapses while minimized, so only the
  // chrome-offset-derived normal-bounds fallback (not the plain host-content-area fallback) can succeed.
  f.host.collapseContentWhenMinimized = true;
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(f.host.views[0].bounds, { x: 0, y: 0, width: f.host.normalContent.width, height: f.host.normalContent.height });
});

test("primeChromeOffset alone does not request a relayout or publish a new state", async () => {
  const f = setup();
  const before = f.controller.getState();
  f.controller.primeChromeOffset();
  const after = f.controller.getState();
  assert.equal(after.revision, before.revision, "priming the chrome offset must not itself publish a state change");
  assert.equal(after.layoutRevision, before.layoutRevision);
});

test("minimized with no content size and no prior measurement: still PANEL_NOT_READY (no fallback possible)", async () => {
  const f = setup();
  f.host.minimize();
  f.host.content = { width: 0, height: 0 };
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PANEL_NOT_READY");
  assert.equal(result.error.effect, "none");
  assert.equal(f.controller.ownership.getOwner().kind, "none");
});

test("not minimized and the renderer never reports a layout: still PANEL_NOT_READY (the fallback is minimized-only)", async () => {
  const f = setup();
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PANEL_NOT_READY");
  assert.equal(f.controller.ownership.getOwner().kind, "none");
});

test("minimized fallback reuses the last real measurement (savedBounds) across a renderer reload, not just the content area", async () => {
  const f = setup();
  const a = f.issue("A");
  const firstAcquire = f.controller.acquire(a.handle, { url: URL1 });
  await new Promise((resolve) => setImmediate(resolve));
  presentPanel(f.controller); // answer the real layout once, manually (no autoRenderer here)
  const first = await firstAcquire;
  assert.equal(first.ok, true, JSON.stringify(first));
  const realBounds = { ...f.host.views[0].bounds };
  await f.controller.release(a.handle, { leaseId: first.result.leaseId });
  f.controller.beginRendererEpoch(); // simulates a renderer reload: lastBounds is cleared, savedBounds is not
  f.host.minimize();
  const second = await f.controller.acquire(f.issue("B").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(f.host.views.at(-1).bounds, realBounds, "the saved real measurement is reused instead of a generic default");
});

test("a minimized fallback is replaced by a real measurement on restore (never trusted as final)", async () => {
  const f = setup();
  f.host.minimize();
  const result = await f.controller.acquire(f.issue("A").handle, { url: URL1, timeoutMs: 300 });
  assert.equal(result.ok, true, JSON.stringify(result));
  f.host.restore();
  f.controller.onWindowRestored();
  assert.equal(f.controller.getState().operationReady, false, "the fallback bounds never satisfy a real geometry check");
  presentPanel(f.controller);
  assert.equal(f.controller.getState().operationReady, true);
});

test("unfocused and covered windows are operable (focus and occlusion by other apps are not conditions)", async () => {
  const f = await acquired();
  f.host.windowFocused = false;
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease })).ok, true);
  assert.equal(f.controller.getState().panelVisible, true);
});

test("explicit hide expires the lease and refuses operations; show never revives the old lease", async () => {
  const f = await acquired();
  f.host.windowVisible = false;
  f.controller.onWindowHidden();
  assert.equal(f.controller.ownership.getOwner().kind, "none");
  assert.equal(f.controller.getState().operationReady, false);
  const refused = await f.controller.getText(f.a.handle, { leaseId: f.lease });
  assert.equal(refused.error.code, "BROWSER_UNAVAILABLE");
  assert.equal(refused.error.effect, "none");
  assert.equal(f.controller.status().result.available, false);
  assert.match(refused.error.message, /explicitly hidden/);
  f.host.windowVisible = true;
  f.controller.onWindowShown();
  presentPanel(f.controller);
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease })).ok, false, "the old lease stays dead");
  assert.equal((await f.controller.release(f.a.handle, { leaseId: f.lease })).ok, false);
});

test("explicit hide while minimized still ends the lease", async () => {
  const f = await acquired();
  f.host.minimize();
  f.controller.onWindowMinimized();
  f.controller.onWindowHidden();
  assert.equal(f.controller.ownership.getOwner().kind, "none");
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease })).error.code, "BROWSER_UNAVAILABLE");
});

test("hide mid-operation stops delivery and keeps the effect (not retryable once a side effect is possible)", async () => {
  const f = await acquired();
  f.wc.pageHandlers.prepareFill = async () => { f.controller.onWindowHidden(); return { ok: true, empty: true }; };
  f.wc.pageHandlers.verifyFill = async () => ({ ok: true, matches: true, focused: true });
  const snapshotId = await takeSnapshot(f.controller, f.a.handle, f.lease, f.wc);
  const result = await f.controller.fill(f.a.handle, { leaseId: f.lease, snapshotId, ref: "r", text: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BROWSER_UNAVAILABLE");
  assert.equal(f.wc.inputs.length, 0, "nothing was delivered after the gate closed");
});

test("screen lock and suspend refuse with SYSTEM_* and end the lease; resume never revives it", async () => {
  const f = await acquired();
  f.controller.onSystemLocked();
  assert.equal(f.controller.ownership.getOwner().kind, "none");
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease })).error.code, "SYSTEM_LOCKED");
  assert.equal((await f.controller.acquire(f.issue("B").handle, { url: URL1 })).error.code, "SYSTEM_LOCKED");
  assert.equal(f.controller.status().result.blockedReason, "SYSTEM_LOCKED");
  f.controller.onSystemSuspend();
  assert.equal((await f.controller.acquire(f.issue("C").handle, { url: URL1 })).error.code, "SYSTEM_SUSPENDED");
  f.controller.onSystemUnlocked();
  assert.equal((await f.controller.acquire(f.issue("D").handle, { url: URL1 })).error.code, "SYSTEM_SUSPENDED");
  f.controller.onSystemResume();
  assert.notEqual((await f.controller.getText(f.a.handle, { leaseId: f.lease })).ok, true, "the old lease is not revived");
  assert.equal(f.controller.status().result.blockedReason, null);
});

test("modal and resize keep refusing with PANEL_OCCLUDED even while minimized", async () => {
  const f = await acquired();
  f.host.minimize();
  f.controller.onWindowMinimized();
  f.controller.setPresentation({ open: true, occluded: true, resizing: false });
  assert.equal(f.controller.getState().operationReady, false);
  assert.equal((await f.controller.getText(f.a.handle, { leaseId: f.lease })).error.code, "PANEL_OCCLUDED");
  assert.equal(f.controller.status().result.blockedReason, "PANEL_OCCLUDED");
  assert.equal(f.controller.status().result.available, true);
});

test("release works while operations are blocked", async () => {
  const f = await acquired();
  f.controller.setPresentation({ open: true, occluded: true, resizing: false });
  const released = await f.controller.release(f.a.handle, { leaseId: f.lease });
  assert.equal(released.ok, true);
  assert.equal(f.controller.ownership.getOwner().kind, "none");
});

test("background throttling is disabled on the page and the host only while an agent holds the browser, and restored after", async () => {
  const f = await acquired();
  assert.equal(f.wc.throttling, false);
  assert.equal(f.host.hostThrottling, false);
  await f.controller.release(f.a.handle, { leaseId: f.lease });
  assert.equal(f.wc.throttling, true);
  assert.equal(f.host.hostThrottling, true);
  const g = await acquired();
  assert.equal(g.host.hostThrottling, false);
  g.controller.onWindowHidden();
  assert.equal(g.host.hostThrottling, true, "hide ends the lease and restores throttling");
  const h = await acquired();
  h.controller.dispose();
  assert.equal(h.host.hostThrottling, true, "dispose restores throttling");
});

test("a replacement view created during a lease also gets throttling disabled", async () => {
  const f = await acquired();
  await f.controller.release(f.a.handle, { leaseId: f.lease });
  const b = f.issue("B");
  const second = await f.controller.acquire(b.handle, { url: URL1 });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(f.host.views.at(-1).webContents.throttling, false);
});

test("screenshot failures are explicit: capture error, empty image, no page frames, hung capture", async () => {
  const f = await acquired();
  f.wc.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  f.wc.captureError = "Current display surface not available for capture";
  const failed = await f.controller.screenshot(f.a.handle, { leaseId: f.lease });
  assert.equal(failed.error.code, "SCREENSHOT_UNAVAILABLE");
  f.wc.captureError = null;
  f.wc.shot = { width: 0, height: 0, bytes: 10 };
  assert.equal((await f.controller.screenshot(f.a.handle, { leaseId: f.lease })).error.code, "SCREENSHOT_UNAVAILABLE");
  f.wc.shot = null;
  f.wc.pageHandlers.settleFrames = async () => ({ ok: false, code: "SCREENSHOT_UNAVAILABLE", message: "The page is not producing frames" });
  assert.equal((await f.controller.screenshot(f.a.handle, { leaseId: f.lease })).error.code, "SCREENSHOT_UNAVAILABLE", "no frames: never a possibly stale image");
  f.wc.pageHandlers.settleFrames = async () => ({ ok: true });
  f.wc.capturePage = () => new Promise(() => {});
  const hung = await f.controller.screenshot(f.a.handle, { leaseId: f.lease, timeoutMs: 20000 });
  assert.equal(hung.error.code, "SCREENSHOT_UNAVAILABLE", "a capture that never answers is bounded");
});

/**
 * Issue #42 W2 (Windows): capturePage can succeed with a stale image when a minimized window's
 * compositor stops presenting new frames. On win32 only, require a presented frame before trusting it.
 */
function withPlatform(value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value, configurable: true });
  return fn().finally(() => Object.defineProperty(process, "platform", original));
}

test("win32: a capture with no presented frame is SCREENSHOT_UNAVAILABLE, never a stale image", async () => {
  const f = await acquired();
  f.wc.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  f.wc.framePresents = false;
  await withPlatform("win32", async () => {
    const result = await f.controller.screenshot(f.a.handle, { leaseId: f.lease, timeoutMs: 5000 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SCREENSHOT_UNAVAILABLE");
  });
});

test("win32: a capture with a presented frame succeeds", async () => {
  const f = await acquired();
  f.wc.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  f.wc.framePresents = true;
  await withPlatform("win32", async () => {
    const result = await f.controller.screenshot(f.a.handle, { leaseId: f.lease });
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});

test("non-win32 platforms are unaffected by the frame-presentation gate (no behavior change)", async () => {
  const f = await acquired();
  f.wc.pageHandlers.viewport = async () => ({ ok: true, width: 480, height: 700, readyState: "complete" });
  f.wc.framePresents = false;
  const result = await f.controller.screenshot(f.a.handle, { leaseId: f.lease });
  assert.equal(result.ok, true, JSON.stringify(result), "darwin/linux never wait on beginFrameSubscription");
});
