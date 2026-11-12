const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BrowserInstructionStateStore, browserInstructionNamespace } = require("../dist/main/browser-instruction-state-store.js");
const { resolveBrowserInstructionUpdate } = require("../dist/main/agent-sdk-config.js");

const silent = { info() {}, error() {} };
const OFF = resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: false }).state;
const ON = resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: false }).state;
const NS = browserInstructionNamespace("/codex-home");

const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-store-"));
  dirs.push(dir);
  return { dir, file: path.join(dir, "state.json") };
}
const open = (file, io) => new BrowserInstructionStateStore({ filePath: file, io, logger: silent });

async function confirmed(store, thread, state) {
  const attempt = await store.begin(NS, thread, state);
  assert.equal(await store.confirm(attempt), true);
}

test("missing file: every thread is unknown and the first begin asks for the update", async () => {
  const { file } = tmp();
  const store = open(file);
  const attempt = await store.begin(NS, "t1", OFF);
  assert.equal(attempt.sendUpdate, true);
  assert.equal(store.peek(NS, "t1").status, "pending", "pending is persisted before any turn");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).namespaces[NS].t1.status, "pending");
});

test("restart restores confirmed and suppresses the resend", async () => {
  const { file } = tmp();
  const a = open(file);
  await confirmed(a, "t1", OFF);
  const b = open(file);
  const attempt = await b.begin(NS, "t1", OFF);
  assert.equal(attempt.sendUpdate, false);
  assert.equal(await b.confirm(attempt), true);
  assert.equal((await b.begin(NS, "t1", ON)).sendUpdate, true, "a different state is still sent");
});

test("state change (browser, evaluate, digest) each requires exactly one update", async () => {
  const { file } = tmp();
  const store = open(file);
  await confirmed(store, "t1", OFF);
  const evalOn = resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: true }).state;
  for (const next of [ON, evalOn, { ...evalOn, instructionDigest: "revised-text-digest" }, OFF]) {
    const attempt = await store.begin(NS, "t1", next);
    assert.equal(attempt.sendUpdate, true);
    assert.equal(await store.confirm(attempt), true);
    const same = await store.begin(NS, "t1", next);
    assert.equal(same.sendUpdate, false, "same state is not re-sent");
    assert.equal(await store.confirm(same), true);
  }
});

test("crash: a pending record read by a new process is unknown", async () => {
  const { file } = tmp();
  const a = open(file);
  await confirmed(a, "t1", OFF);
  await a.begin(NS, "t1", OFF); // same state, in flight, process dies here
  const b = open(file);
  assert.equal((await b.begin(NS, "t1", OFF)).sendUpdate, true);
  assert.equal(b.peek(NS, "other").status, "unknown");
});

test("failed or interrupted attempt does not fall back to the previous confirmed state", async () => {
  const { file } = tmp();
  const store = open(file);
  await confirmed(store, "t1", OFF);
  const toOn = await store.begin(NS, "t1", ON);
  await store.markUnknown(toOn);
  const record = store.peek(NS, "t1");
  assert.equal(record.status, "unknown");
  assert.equal(record.confirmedState, undefined);
  assert.equal((await store.begin(NS, "t1", OFF)).sendUpdate, true, "OFF must be re-announced after a possibly delivered ON");
});

test("corrupt, empty, unknown-schema and malformed records all read as unknown and recover on the next write", async () => {
  for (const content of ["{not json", "", JSON.stringify({ schemaVersion: 99, namespaces: {} }), JSON.stringify({ schemaVersion: 1, namespaces: { [NS]: { t1: { status: "confirmed", generation: 3 }, t2: "garbage", t3: { status: "confirmed", generation: 1, confirmedState: { browser: "maybe" } } } } })]) {
    const { file } = tmp();
    fs.writeFileSync(file, content);
    const store = open(file);
    for (const thread of ["t1", "t2", "t3"]) {
      const attempt = await store.begin(NS, thread, OFF);
      assert.equal(attempt.sendUpdate, true, `${thread} unknown for: ${content.slice(0, 20)}`);
      await store.confirm(attempt);
    }
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion, 1, "file rewritten in the valid schema");
  }
});

test("a store that cannot be written refuses to begin (no turn may follow) and leaves memory unchanged", async () => {
  const { file } = tmp();
  let fail = true;
  const io = {
    readFile: async () => null,
    writeFileAtomic: async (f, content) => { if (fail) throw new Error("disk full"); fs.writeFileSync(f, content); }
  };
  const store = open(file, io);
  await assert.rejects(store.begin(NS, "t1", OFF), /保存できませんでした/);
  assert.equal(store.peek(NS, "t1").status, "unknown");
  fail = false;
  assert.equal((await store.begin(NS, "t1", OFF)).sendUpdate, true);
});

test("a failing confirm save leaves the thread non-confirmed so the next turn re-sends", async () => {
  const { file } = tmp();
  let fail = false;
  const io = {
    readFile: async () => null,
    writeFileAtomic: async (f, content) => { if (fail) throw new Error("EIO"); fs.writeFileSync(f, content); }
  };
  const store = open(file, io);
  const attempt = await store.begin(NS, "t1", OFF);
  fail = true;
  assert.equal(await store.confirm(attempt), false);
  fail = false;
  assert.equal((await store.begin(NS, "t1", OFF)).sendUpdate, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).namespaces[NS].t1.status, "pending", "disk still says pending");
});

test("a late completion from an older attempt can neither confirm nor reset a newer record (generation/attempt id)", async () => {
  const { file } = tmp();
  const store = open(file);
  const old = await store.begin(NS, "t1", OFF);
  await store.markUnknown(old);
  const fresh = await store.begin(NS, "t1", ON);
  assert.equal(await store.confirm(old), false);
  await store.markUnknown(old);
  assert.equal(store.peek(NS, "t1").status, "pending", "newer attempt untouched by the stale one");
  assert.equal(await store.confirm(fresh), true);
  assert.equal(store.peek(NS, "t1").confirmedState.browser, "on");
});

test("compaction marks unknown so a completion arriving afterwards cannot confirm", async () => {
  const { file } = tmp();
  const store = open(file);
  const attempt = await store.begin(NS, "t1", OFF);
  await store.markUnknown(attempt); // compaction observed mid-turn
  assert.equal(await store.confirm(attempt), false);
  assert.equal((await store.begin(NS, "t1", OFF)).sendUpdate, true);
});

test("concurrent updates of different threads are both kept, and also after a restart", async () => {
  const { file } = tmp();
  const store = open(file);
  const threads = Array.from({ length: 20 }, (_, i) => `t${i}`);
  await Promise.all(threads.map(async (t, i) => { const a = await store.begin(NS, t, i % 2 ? ON : OFF); await store.confirm(a); }));
  const again = open(file);
  for (const [i, t] of threads.entries()) {
    assert.equal((await again.begin(NS, t, i % 2 ? ON : OFF)).sendUpdate, false, `${t} kept`);
  }
});

test("namespaces are separate per Codex Home", async () => {
  const { file } = tmp();
  const store = open(file);
  const other = browserInstructionNamespace("/another-home");
  assert.notEqual(other, NS);
  await confirmed(store, "same-thread-id", OFF);
  assert.equal((await store.begin(other, "same-thread-id", OFF)).sendUpdate, true);
});

test("same-thread occupancy: a second claim is refused until released; other threads are free", () => {
  const store = open(tmp().file);
  const release = store.tryAcquireThread(NS, "t1");
  assert.ok(release);
  assert.equal(store.tryAcquireThread(NS, "t1"), null);
  assert.ok(store.tryAcquireThread(NS, "t2"));
  release(); release();
  assert.ok(store.tryAcquireThread(NS, "t1"));
});

test("the default writer replaces the file atomically and leaves no temp files", async () => {
  const { dir, file } = tmp();
  const store = open(file);
  await confirmed(store, "t1", OFF);
  await confirmed(store, "t2", ON);
  assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  const text = fs.readFileSync(file, "utf8");
  assert.equal(/token|prompt|content/i.test(text), false, "no conversation text or secrets stored");
});
