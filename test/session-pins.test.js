const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

function loadModule() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, "src/shared/session-pins.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const pins = loadModule();

const session = (id, extra = {}) => ({ id, updatedAt: 1, createdAt: 1, ...extra });

// --- U1: model / compare ---------------------------------------------------

test("isSessionPinned: undefined/false/true", () => {
  assert.equal(pins.isSessionPinned({ isPinned: undefined }), false);
  assert.equal(pins.isSessionPinned({ isPinned: false }), false);
  assert.equal(pins.isSessionPinned({ isPinned: true }), true);
});

test("splitPinnedSessions: Heartbeat is excluded from the pinned group even when isPinned is true", () => {
  const a = session("heartbeat-assistant", { isPinned: true });
  const b = session("heartbeat-assistant:2026-11-15", { isPinned: true });
  const c = session("normal", { isPinned: true });
  const { pinned, rest } = pins.splitPinnedSessions([a, b, c]);
  assert.deepEqual(pinned.map((s) => s.id), ["normal"]);
  assert.deepEqual(rest.map((s) => s.id), ["heartbeat-assistant", "heartbeat-assistant:2026-11-15"]);
});

test("splitPinnedSessions: order is updatedAt desc, then createdAt desc, then ID ascending by code unit", () => {
  const sessions = [
    session("b", { isPinned: true, updatedAt: 5, createdAt: 1 }),
    session("a", { isPinned: true, updatedAt: 10, createdAt: 1 }),
    session("z", { isPinned: true, updatedAt: 5, createdAt: 9 }),
    session("y", { isPinned: true, updatedAt: 5, createdAt: 1 })
  ];
  const { pinned } = pins.splitPinnedSessions(sessions);
  assert.deepEqual(pinned.map((s) => s.id), ["a", "z", "b", "y"]);
});

test("splitPinnedSessions: ties are broken without localeCompare (plain code-unit order)", () => {
  // "Z" (90) sorts before "a" (97) under plain `<`, unlike locale-aware comparators.
  const sessions = [
    session("a", { isPinned: true, updatedAt: 1, createdAt: 1 }),
    session("Z", { isPinned: true, updatedAt: 1, createdAt: 1 })
  ];
  const { pinned } = pins.splitPinnedSessions(sessions);
  assert.deepEqual(pinned.map((s) => s.id), ["Z", "a"]);
});

test("splitPinnedSessions: does not mutate the input array", () => {
  const sessions = [
    session("b", { isPinned: true, updatedAt: 1, createdAt: 1 }),
    session("a", { isPinned: true, updatedAt: 2, createdAt: 1 })
  ];
  const copy = [...sessions];
  pins.splitPinnedSessions(sessions);
  assert.deepEqual(sessions, copy);
});

test("splitPinnedSessions: 0, 1 and multiple pins, no duplicates", () => {
  assert.deepEqual(pins.splitPinnedSessions([session("a")]).pinned, []);
  assert.deepEqual(pins.splitPinnedSessions([session("a", { isPinned: true })]).pinned.map((s) => s.id), ["a"]);
  const many = [session("a", { isPinned: true }), session("b", { isPinned: true }), session("c")];
  const { pinned, rest } = pins.splitPinnedSessions(many);
  assert.deepEqual(pinned.map((s) => s.id).sort(), ["a", "b"]);
  assert.deepEqual(rest.map((s) => s.id), ["c"]);
  assert.equal(new Set(pinned.map((s) => s.id)).size, pinned.length);
});

// --- U2: classification -----------------------------------------------------

test("projectListGroups: cron match by UI session ID or by backend session ID", () => {
  const byUiId = session("ui-1", { updatedAt: 1, createdAt: 1 });
  const byBackendId = session("ui-2", { backendSessionId: "backend-2", updatedAt: 1, createdAt: 1 });
  const schedules = [
    { kind: "cron", sessionId: "ui-1" },
    { kind: "cron", sessionId: "backend-2" }
  ];
  const { scheduled, regular } = pins.projectListGroups([byUiId, byBackendId], schedules);
  assert.deepEqual(scheduled.map((s) => s.id).sort(), ["ui-1", "ui-2"]);
  assert.deepEqual(regular, []);
});

test("projectListGroups: one_shot schedules do not count as scheduled", () => {
  const s = session("ui-1");
  const { scheduled, regular } = pins.projectListGroups([s], [{ kind: "one_shot", sessionId: "ui-1" }]);
  assert.deepEqual(scheduled, []);
  assert.deepEqual(regular.map((x) => x.id), ["ui-1"]);
});

test("projectListGroups: pinned cron session moves to pinned group and out of scheduled", () => {
  const s = session("ui-1", { isPinned: true });
  const { pinned, scheduled, regular } = pins.projectListGroups([s], [{ kind: "cron", sessionId: "ui-1" }]);
  assert.deepEqual(pinned.map((x) => x.id), ["ui-1"]);
  assert.deepEqual(scheduled, []);
  assert.deepEqual(regular, []);
});

test("projectListGroups: unpinning returns the session to its current cron classification", () => {
  const cron = [{ kind: "cron", sessionId: "ui-1" }];
  const pinnedResult = pins.projectListGroups([session("ui-1", { isPinned: true })], cron);
  assert.deepEqual(pinnedResult.scheduled, []);
  const unpinnedResult = pins.projectListGroups([session("ui-1", { isPinned: false })], cron);
  assert.deepEqual(unpinnedResult.scheduled.map((x) => x.id), ["ui-1"]);
});

test("projectListGroups: within a group, order follows updatedAt desc", () => {
  const schedules = [];
  const sessions = [session("a", { updatedAt: 1, createdAt: 1 }), session("b", { updatedAt: 5, createdAt: 1 })];
  const { regular } = pins.projectListGroups(sessions, schedules);
  // projectListGroups does not itself re-sort non-pinned groups: it preserves caller order (app.ts already sorts).
  assert.deepEqual(regular.map((s) => s.id), ["a", "b"]);
});

test("projectActivityGroups: pinned group plus a flat remainder, no extra headers", () => {
  const sessions = [session("a", { isPinned: true, updatedAt: 1, createdAt: 1 }), session("b", { updatedAt: 2, createdAt: 1 })];
  const { pinned, rest } = pins.projectActivityGroups(sessions);
  assert.deepEqual(pinned.map((s) => s.id), ["a"]);
  assert.deepEqual(rest.map((s) => s.id), ["b"]);
});

test("isCronScheduledSession: no match when neither ID lines up", () => {
  const s = session("ui-1", { backendSessionId: "backend-1" });
  assert.equal(pins.isCronScheduledSession(s, [{ kind: "cron", sessionId: "other" }]), false);
});
