const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserOwnership, SerialQueue } = require("../dist/main/browser-ownership.js");
const { computeViewBounds, parseViewportUpdate, ViewportGate, resolvePanelLayout, ExpectedInputLedger } = require("../dist/main/browser-bounds.js");

function runs() {
  const o = new BrowserOwnership();
  const a = o.issueRun({ conversationId: "A", requestId: "ra", policyRevision: 1 });
  const b = o.issueRun({ conversationId: "B", requestId: "rb", policyRevision: 1 });
  return { o, a, b };
}

test("tokens resolve to their run and are unique 256-bit values", () => {
  const { o, a, b } = runs();
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(o.resolveToken(a.token).conversationId, "A");
  assert.equal(o.resolveToken("x".repeat(64)), null);
});

test("A/B conflict: second conversation gets BROWSER_BUSY, no takeover", () => {
  const { o, a, b } = runs();
  o.acquire(a.runId);
  assert.throws(() => o.acquire(b.runId), { code: "BROWSER_BUSY" });
  assert.deepEqual(o.ownerView(), { kind: "agent", conversationId: "A" });
});

test("same run re-acquire returns the same lease", () => {
  const { o, a } = runs();
  const first = o.acquire(a.runId);
  const second = o.acquire(a.runId);
  assert.equal(second.leaseId, first.leaseId);
  assert.equal(second.reused, true);
});

test("release frees the browser for another run and stale leases are rejected", () => {
  const { o, a, b } = runs();
  const lease = o.acquire(a.runId);
  o.release(a.runId, lease.leaseId);
  assert.throws(() => o.assertLease(a.runId, lease.leaseId), { code: "BROWSER_NOT_OWNED" });
  const next = o.acquire(b.runId);
  assert.throws(() => o.assertLease(a.runId, lease.leaseId), { code: "LEASE_EXPIRED" });
  assert.throws(() => o.assertLease(b.runId, "wrong"), { code: "LEASE_EXPIRED" });
  o.assertLease(b.runId, next.leaseId);
});

test("run revocation aborts its signal, frees the lease, and kills the token", () => {
  const { o, a } = runs();
  const lease = o.acquire(a.runId);
  const resolved = o.resolveToken(a.token);
  o.revokeRun(a.runId);
  assert.equal(resolved.signal.aborted, true);
  assert.equal(o.resolveToken(a.token), null);
  assert.equal(o.getOwner().kind, "none");
  assert.throws(() => o.assertLease(a.runId, lease.leaseId), { code: "CANCELLED" });
});

test("manual takeover expires the lease, blocks reacquire for that run (USER_INTERRUPTED)", () => {
  const { o, a, b } = runs();
  const lease = o.acquire(a.runId);
  const epoch = o.epochs.ownershipEpoch;
  o.takeControl();
  assert.deepEqual(o.ownerView(), { kind: "user" });
  assert.ok(o.epochs.ownershipEpoch > epoch);
  assert.throws(() => o.assertLease(a.runId, lease.leaseId), { code: "USER_INTERRUPTED" });
  assert.throws(() => o.acquire(a.runId), { code: "USER_INTERRUPTED" });
  assert.throws(() => o.acquire(b.runId), { code: "BROWSER_BUSY" });
  o.allowAgentControl();
  assert.ok(o.acquire(b.runId).leaseId);
});

test("closing the panel (interrupted expiry) forbids reacquire by that run but a new run can acquire", () => {
  const { o, a } = runs();
  o.acquire(a.runId);
  o.expireLease({ interrupted: true });
  assert.throws(() => o.acquire(a.runId), { code: "USER_INTERRUPTED" });
  const fresh = o.issueRun({ conversationId: "A", requestId: "ra2", policyRevision: 1 });
  assert.ok(o.acquire(fresh.runId).leaseId);
});

test("non-interrupting expiry (window hidden) lets the same run reacquire", () => {
  const { o, a } = runs();
  o.acquire(a.runId);
  o.expireLease({ interrupted: false });
  assert.ok(o.acquire(a.runId).leaseId);
});

test("issuing can be stopped (settings OFF)", () => {
  const o = new BrowserOwnership();
  o.setIssuing(false);
  assert.throws(() => o.issueRun({ conversationId: "A", requestId: "r", policyRevision: 1 }), { code: "BROWSER_DISABLED" });
});

test("SerialQueue runs operations in order and runs the guard right before each one", async () => {
  const q = new SerialQueue();
  const order = [];
  let valid = true;
  const slow = q.enqueue(async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a"); }, () => {});
  const stale = q.enqueue(async () => { order.push("b"); }, () => { if (!valid) throw new Error("stale"); });
  valid = false;
  await slow;
  await assert.rejects(stale, /stale/);
  assert.deepEqual(order, ["a"]);
  await q.enqueue(async () => order.push("c"), () => {});
  assert.deepEqual(order, ["a", "c"]);
});

test("SerialQueue bounds pending operations", async () => {
  const q = new SerialQueue(2);
  const block = new Promise(() => {});
  q.enqueue(() => block, () => {});
  q.enqueue(() => block, () => {});
  await assert.rejects(q.enqueue(async () => 1, () => {}), { code: "BROWSER_BUSY" });
});

test("computeViewBounds applies zoom only, rounds inward, clamps and rejects invalid input", () => {
  assert.deepEqual(computeViewBounds({ x: 10.2, y: 20.2, width: 100.5, height: 50.5 }, 1, { width: 500, height: 500 }), { x: 11, y: 21, width: 99, height: 49 });
  assert.deepEqual(computeViewBounds({ x: 100, y: 100, width: 100, height: 100 }, 1.5, { width: 500, height: 400 }), { x: 150, y: 150, width: 150, height: 150 });
  assert.deepEqual(computeViewBounds({ x: 400, y: 0, width: 400, height: 100 }, 1, { width: 500, height: 500 }), { x: 400, y: 0, width: 100, height: 100 });
  assert.deepEqual(computeViewBounds({ x: -50, y: -10, width: 100, height: 100 }, 1, { width: 500, height: 500 }), { x: 0, y: 0, width: 50, height: 90 });
  assert.equal(computeViewBounds({ x: 600, y: 0, width: 100, height: 100 }, 1, { width: 500, height: 500 }), null);
  for (const bad of [NaN, Infinity, -1, 0]) {
    assert.equal(computeViewBounds({ x: 0, y: 0, width: bad, height: 10 }, 1, { width: 500, height: 500 }), null);
  }
  assert.equal(computeViewBounds({ x: 0, y: 0, width: 10, height: 10 }, NaN, { width: 500, height: 500 }), null);
  assert.equal(computeViewBounds({ x: 0, y: 0, width: 10, height: 10 }, 0, { width: 500, height: 500 }), null);
});

const goodUpdate = () => ({ rendererEpoch: "e1", seq: 1, layoutRevision: 1, viewport: { x: 1, y: 2, width: 3, height: 4 }, hostViewport: { width: 10, height: 10 }, panelOpen: true, occluded: false, resizing: false });

test("parseViewportUpdate rejects malformed and non-finite payloads", () => {
  assert.ok(parseViewportUpdate(goodUpdate()));
  assert.equal(parseViewportUpdate(null), null);
  assert.equal(parseViewportUpdate({ ...goodUpdate(), seq: NaN }), null);
  assert.equal(parseViewportUpdate({ ...goodUpdate(), viewport: { x: 1, y: 2, width: "3", height: 4 } }), null);
  assert.equal(parseViewportUpdate({ ...goodUpdate(), occluded: "no" }), null);
  assert.equal(parseViewportUpdate({ ...goodUpdate(), rendererEpoch: 5 }), null);
});

test("ViewportGate drops old epochs, old seq numbers and old layout revisions", () => {
  const gate = new ViewportGate("e1", 2);
  assert.equal(gate.accept({ ...goodUpdate(), layoutRevision: 1 }), false);
  assert.equal(gate.accept({ ...goodUpdate(), seq: 5, layoutRevision: 2 }), true);
  assert.equal(gate.accept({ ...goodUpdate(), seq: 5, layoutRevision: 2 }), false);
  assert.equal(gate.accept({ ...goodUpdate(), seq: 4, layoutRevision: 2 }), false);
  assert.equal(gate.accept({ ...goodUpdate(), rendererEpoch: "e0", seq: 9, layoutRevision: 2 }), false);
  gate.reset("e2", 3);
  assert.equal(gate.accept({ ...goodUpdate(), rendererEpoch: "e2", seq: 1, layoutRevision: 3 }), true);
});

test("resolvePanelLayout: keeps both, closes sidebar first, then reports too narrow", () => {
  const base = { sidebarOpen: true, sidebarWidth: 272, handleWidth: 6, preferredPanelWidth: 480, panelMin: 320, panelMax: 960, chatMin: 320 };
  assert.deepEqual(resolvePanelLayout({ ...base, bodyWidth: 1400 }), { panelWidth: 480, closeSidebar: false, tooNarrow: false });
  const squeezed = resolvePanelLayout({ ...base, bodyWidth: 900 });
  assert.equal(squeezed.closeSidebar, true);
  assert.equal(squeezed.tooNarrow, false);
  assert.equal(squeezed.panelWidth, 480);
  const tiny = resolvePanelLayout({ ...base, bodyWidth: 600 });
  assert.equal(tiny.tooNarrow, true);
  assert.equal(tiny.panelWidth, 0);
  // preferred width is clamped to bounds, never persisted by this function
  assert.equal(resolvePanelLayout({ ...base, sidebarOpen: false, bodyWidth: 2000, preferredPanelWidth: 5000 }).panelWidth, 960);
  assert.equal(resolvePanelLayout({ ...base, sidebarOpen: false, bodyWidth: 2000, preferredPanelWidth: 10 }).panelWidth, 320);
});

test("ExpectedInputLedger consumes planned input once and expires", () => {
  let now = 0;
  const ledger = new ExpectedInputLedger(() => now, 1000);
  ledger.expect("mouse:mouseDown", { x: 10, y: 10 });
  assert.equal(ledger.consume("mouse:mouseDown", { x: 50, y: 10 }), false);
  assert.equal(ledger.consume("mouse:mouseDown", { x: 10.5, y: 9.5 }), true);
  assert.equal(ledger.consume("mouse:mouseDown", { x: 10, y: 10 }), false);
  ledger.expect("key:keyDown");
  now = 2000;
  assert.equal(ledger.consume("key:keyDown"), false);
  assert.equal(ledger.size, 0);
});
