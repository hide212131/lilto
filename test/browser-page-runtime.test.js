const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { buildRuntimeCall, BROWSER_PAGE_WORLD_ID, BROWSER_RUNTIME_METHODS } = require("../dist/main/browser-page-runtime.js");

test("runtime source compiles for every method and passes args as JSON", () => {
  assert.equal(BROWSER_PAGE_WORLD_ID, 1001);
  for (const method of BROWSER_RUNTIME_METHODS) {
    const code = buildRuntimeCall(method, { a: 1, s: "  quote\"" });
    new vm.Script(code); // syntax check only; behaviour needs a real DOM (see verify-embedded-browser.js)
    assert.match(code, new RegExp(`__liltoBrowser\\["${method}"\\]\\(`));
  }
});

test("installing twice is idempotent and exposes a fixed method set on a stub global", () => {
  const sandbox = { Math, Date, WeakMap, Map, Set, Array, JSON, Promise, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  const stubDocument = { documentElement: null, body: null, activeElement: null, readyState: "complete" };
  Object.assign(sandbox, { document: stubDocument, window: { innerWidth: 480, innerHeight: 700, scrollX: 0, scrollY: 0 }, getComputedStyle: () => ({}), requestAnimationFrame: (f) => setTimeout(f, 0), Element: class {}, Event: class {} });
  const ctx = vm.createContext(sandbox);
  const result1 = vm.runInContext(buildRuntimeCall("viewport", {}), ctx);
  const first = sandbox.__liltoBrowser;
  const result2 = vm.runInContext(buildRuntimeCall("viewport", {}), ctx);
  assert.equal(sandbox.__liltoBrowser, first);
  assert.deepEqual(Object.keys(first).sort(), [...BROWSER_RUNTIME_METHODS, "nonce"].sort());
  assert.equal(result1.ok, true);
  assert.equal(result1.nonce, result2.nonce);
  // Empty document: snapshot returns a valid, empty, non-truncated dom-v1 tree.
  const snap = vm.runInContext(buildRuntimeCall("snapshot", { snapshotId: "s1", ownershipEpoch: 1, documentEpoch: 1, maxNodes: 10 }), ctx);
  assert.equal(snap.snapshot.format, "dom-v1");
  assert.deepEqual(JSON.parse(JSON.stringify(snap.snapshot.nodes)), []);
  assert.equal(snap.snapshot.truncated, false);
  // A ref from an unknown/other snapshot is stale, never resolved.
  const stale = vm.runInContext(buildRuntimeCall("getText", { snapshotId: "other", ref: "b1-d1-n1", maxChars: 10 }), ctx);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "STALE_REF");
});
