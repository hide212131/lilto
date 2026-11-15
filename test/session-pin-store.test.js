const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SessionPinStore, buildSessionPinNamespace } = require("../dist/main/session-pin-store.js");

const silent = { info() {}, error() {} };
const NS = buildSessionPinNamespace("/codex-home", "/work");
const NS2 = buildSessionPinNamespace("/codex-home-2", "/work");

const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-pin-store-"));
  dirs.push(dir);
  return { dir, file: path.join(dir, "session-pins.json") };
}
const open = (file, io) => new SessionPinStore({ filePath: file, io, logger: silent });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// --- U3: save / restore ------------------------------------------------------

test("missing file: empty store, first setPinned creates the file", async () => {
  const { file } = tmp();
  const store = open(file);
  assert.equal(await store.isPinned(NS, "t1"), false);
  const result = await store.setPinned(NS, "t1", true);
  assert.deepEqual(result, { ok: true, isPinned: true });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.schemaVersion, 1);
  assert.deepEqual(saved.namespaces[NS], ["t1"]);
});

test("restart: a separate instance reads back the same pinned IDs", async () => {
  const { file } = tmp();
  const a = open(file);
  await a.setPinned(NS, "t1", true);
  await a.setPinned(NS, "t2", true);
  const b = open(file);
  const ids = await b.getPinnedIds(NS);
  assert.deepEqual([...ids].sort(), ["t1", "t2"]);
});

test("unpin persists across restart", async () => {
  const { file } = tmp();
  const a = open(file);
  await a.setPinned(NS, "t1", true);
  await a.setPinned(NS, "t1", false);
  const b = open(file);
  assert.equal(await b.isPinned(NS, "t1"), false);
});

test("namespace separation: different (codexHome, workspace) pairs never share pins", async () => {
  const { file } = tmp();
  const store = open(file);
  await store.setPinned(NS, "t1", true);
  assert.equal(await store.isPinned(NS2, "t1"), false);
  assert.equal(await store.isPinned(NS, "t1"), true);
});

test("duplicate IDs collapse to a set on load", async () => {
  const { file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, namespaces: { [NS]: ["t1", "t1", "t2"] } }));
  const store = open(file);
  const ids = await store.getPinnedIds(NS);
  assert.deepEqual([...ids].sort(), ["t1", "t2"]);
});

test("invalid individual records: blank IDs and Heartbeat IDs are dropped, not fatal", async () => {
  const { file } = tmp();
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    namespaces: { [NS]: ["t1", "", "   ", "heartbeat-assistant", "heartbeat-assistant:2026-11-15"] }
  }));
  const store = open(file);
  const ids = await store.getPinnedIds(NS);
  assert.deepEqual([...ids], ["t1"]);
});

test("a namespace record that is not an array is skipped without failing the whole load", async () => {
  const { file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, namespaces: { [NS]: "not-an-array", [NS2]: ["t1"] } }));
  const store = open(file);
  assert.deepEqual([...await store.getPinnedIds(NS)], []);
  assert.deepEqual([...await store.getPinnedIds(NS2)], ["t1"]);
});

test("corrupt JSON: file is not overwritten, setPinned fails instead of silently resetting", async () => {
  const { file } = tmp();
  fs.writeFileSync(file, "{not json");
  const before = fs.readFileSync(file, "utf8");
  const store = open(file);
  assert.equal(await store.isPinned(NS, "t1"), false);
  const result = await store.setPinned(NS, "t1", true);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SESSION_PIN_SAVE_FAILED");
  assert.equal(fs.readFileSync(file, "utf8"), before, "corrupt file must be left untouched");
});

test("unknown schemaVersion: file is not overwritten, setPinned fails", async () => {
  const { file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, namespaces: { [NS]: ["t1"] } }));
  const before = fs.readFileSync(file, "utf8");
  const store = open(file);
  const result = await store.setPinned(NS, "t2", true);
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("heartbeat IDs and blank IDs are rejected by setPinned as INVALID_REQUEST", async () => {
  const { file } = tmp();
  const store = open(file);
  assert.equal((await store.setPinned(NS, "heartbeat-assistant", true)).error.code, "INVALID_REQUEST");
  assert.equal((await store.setPinned(NS, "heartbeat-assistant:2026-11-15", true)).error.code, "INVALID_REQUEST");
  assert.equal((await store.setPinned(NS, "   ", true)).error.code, "INVALID_REQUEST");
});

test("resending the same desired state is idempotent", async () => {
  const { file } = tmp();
  const store = open(file);
  assert.deepEqual(await store.setPinned(NS, "t1", true), { ok: true, isPinned: true });
  assert.deepEqual(await store.setPinned(NS, "t1", true), { ok: true, isPinned: true });
  assert.deepEqual([...await store.getPinnedIds(NS)], ["t1"]);
});

// --- U4: write concurrency / failure -----------------------------------------

test("two concurrent setPinned calls for different IDs never lose one another's update", async () => {
  const { file } = tmp();
  const gate = deferred();
  let writes = 0;
  const io = {
    async readFile(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    async writeFileAtomic(p, content) {
      writes += 1;
      if (writes === 1) await gate.promise; // Delay the first write so the second setPinned call queues behind it.
      fs.writeFileSync(p, content);
    }
  };
  const store = open(file, io);
  const first = store.setPinned(NS, "a", true);
  const second = store.setPinned(NS, "b", true);
  gate.resolve();
  assert.deepEqual(await first, { ok: true, isPinned: true });
  assert.deepEqual(await second, { ok: true, isPinned: true });
  const ids = await store.getPinnedIds(NS);
  assert.deepEqual([...ids].sort(), ["a", "b"], "lost update: the second write must see the first write's result");
});

test("write failure keeps the previous in-memory state and cleans up its temp file", async () => {
  const { file, dir } = tmp();
  let fail = false;
  const io = {
    async readFile(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    async writeFileAtomic(p, content) {
      if (fail) throw new Error("disk full");
      fs.writeFileSync(p, content);
    }
  };
  const store = open(file, io);
  await store.setPinned(NS, "t1", true);
  fail = true;
  const result = await store.setPinned(NS, "t2", true);
  assert.equal(result.ok, false);
  const ids = await store.getPinnedIds(NS);
  assert.deepEqual([...ids], ["t1"], "failed write must not be reflected in memory");
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".tmp")), [], "no leaked temp files (io owns its own cleanup)");
});

test("a failed request does not block the next request from succeeding", async () => {
  const { file } = tmp();
  let fail = true;
  const io = {
    async readFile(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    async writeFileAtomic(p, content) {
      if (fail) throw new Error("transient failure");
      fs.writeFileSync(p, content);
    }
  };
  const store = open(file, io);
  const failed = await store.setPinned(NS, "t1", true);
  assert.equal(failed.ok, false);
  fail = false;
  const succeeded = await store.setPinned(NS, "t1", true);
  assert.deepEqual(succeeded, { ok: true, isPinned: true });
});

// --- archive/delete cleanup contract -----------------------------------------

test("removePinOnSuccess unpins a pinned conversation", async () => {
  const { file } = tmp();
  const store = open(file);
  await store.setPinned(NS, "t1", true);
  const result = await store.removePinOnSuccess(NS, "t1");
  assert.deepEqual(result, { ok: true });
  assert.equal(await store.isPinned(NS, "t1"), false);
});

test("removePinOnSuccess reports a warning (not a failure) when the save fails, and retries later", async () => {
  const { file } = tmp();
  let fail = true;
  const io = {
    async readFile(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } },
    async writeFileAtomic(p, content) {
      if (fail) throw new Error("disk full");
      fs.writeFileSync(p, content);
    }
  };
  const store = open(file, io);
  fail = false;
  await store.setPinned(NS, "t1", true);
  fail = true;
  const cleanup = await store.removePinOnSuccess(NS, "t1");
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.warning.code, "SESSION_PIN_CLEANUP_FAILED");
  // The pin must not be readable as pinned any more, even though the write failed: it is logically gone.
  assert.equal(await store.isPinned(NS, "t1"), false);
  fail = false;
  // Next access retries the pending removal and finally persists it.
  assert.deepEqual([...await store.getPinnedIds(NS)], []);
  const b = open(file);
  assert.deepEqual([...await b.getPinnedIds(NS)], [], "retry must have persisted the removal");
});
