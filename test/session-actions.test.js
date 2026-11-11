const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

function loadModule() {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, "src/renderer/session-actions.ts")], bundle: true, format: "cjs", platform: "node", write: false });
  // Same realm as the test, so `instanceof Error` behaves as it does in the renderer.
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const actions = loadModule();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const session = (id, extra = {}) => ({ id, title: `title-${id}`, messages: [], updatedAt: 1, createdAt: 1, ...extra });

function harness({ sessions = [session("a")], running = [], schedules = [], confirm = () => true, invoke = async () => ({ ok: true }), refresh } = {}) {
  const log = { invoked: [], confirms: [], failures: [], cleared: 0, removed: [], cancelled: [], busy: [] };
  const state = { sessions: [...sessions], schedules: [...schedules] };
  const runner = new actions.SessionActionRunner({
    findSession: (id) => state.sessions.find((s) => s.id === id),
    isRunning: (id) => running.includes(id),
    getSchedules: () => state.schedules,
    refreshSchedules: async () => { if (refresh) await refresh(state); },
    confirm: (message) => { log.confirms.push(message); return confirm(message); },
    invoke: async (kind, id) => { log.invoked.push([kind, id]); return invoke(kind, id); },
    onSuccess: (s) => { log.removed.push(s.id); },
    onFailure: (m) => log.failures.push(m),
    clearFailure: () => { log.cleared += 1; },
    onBusyChange: (ids) => log.busy.push(ids),
    onCancelled: (id) => log.cancelled.push(id)
  });
  return { runner, log, state };
}

test("タイトル整形: 空白・改行の正規化、空は名称未設定、120 コードポイント超は末尾「…」", () => {
  assert.equal(actions.formatSessionTitle("  a\n\tb  "), "a b");
  assert.equal(actions.formatSessionTitle(" \n\t "), "名称未設定の会話");
  assert.equal(actions.formatSessionTitle("x".repeat(120)), "x".repeat(120));
  assert.equal(actions.formatSessionTitle("x".repeat(121)), `${"x".repeat(120)}…`);
  const emoji = "😀".repeat(121);
  assert.equal(actions.formatSessionTitle(emoji), `${"😀".repeat(120)}…`);
  assert.equal(actions.deleteConfirmMessage("T"), "「T」を完全に削除しますか？\nこの会話は復元できません。");
});

test("失敗文言は「「{タイトル}」を{操作}できません: {理由}（{code}）」", () => {
  assert.equal(actions.sessionActionFailureMessage("archive", "T", "理由", "CODE"), "「T」をアーカイブできません: 理由（CODE）");
  assert.equal(actions.sessionActionFailureMessage("delete", "", "理由", "CODE"), "「名称未設定の会話」を削除できません: 理由（CODE）");
});

test("archive は確認なしで backend ID を使って実行し、成功後に後処理する", async () => {
  const h = harness({ sessions: [session("ui", { backendSessionId: "thread" })] });
  await h.runner.run("archive", "ui");
  assert.deepEqual(h.log.confirms, []);
  assert.deepEqual(h.log.invoked, [["archive", "thread"]]);
  assert.deepEqual(h.log.removed, ["ui"]);
  assert.deepEqual(h.log.failures, []);
  assert.equal(h.runner.isRemoved("ui"), true);
  assert.equal(h.runner.isBusy("ui"), false);
});

test("delete は確認文面を出し、キャンセルでは IPC を呼ばず失敗表示も出さない", async () => {
  const h = harness({ confirm: () => false });
  await h.runner.run("delete", "a");
  assert.deepEqual(h.log.confirms, ["「title-a」を完全に削除しますか？\nこの会話は復元できません。"]);
  assert.deepEqual(h.log.invoked, []);
  assert.deepEqual(h.log.failures, []);
  assert.deepEqual(h.log.removed, []);
  assert.deepEqual(h.log.cancelled, ["a"]);
  assert.equal(h.runner.isBusy("a"), false);
});

test("delete は承認後に IPC を呼び、成功後に後処理する", async () => {
  const h = harness();
  await h.runner.run("delete", "a");
  assert.deepEqual(h.log.invoked, [["delete", "a"]]);
  assert.deepEqual(h.log.removed, ["a"]);
});

test("実行中の会話は IPC を呼ばず理由を表示する（確認も出さない）", async () => {
  const h = harness({ running: ["a"] });
  await h.runner.run("delete", "a");
  assert.deepEqual(h.log.invoked, []);
  assert.deepEqual(h.log.confirms, []);
  assert.match(h.log.failures[0], /^「title-a」を削除できません: この会話は実行中です。.*（CONVERSATION_BUSY）$/);
});

test("スケジュール参照ありは再取得しても残っていれば拒否し、削除済みなら続行する", async () => {
  const ref = { id: "s", kind: "one_shot", sessionId: "thread" };
  const blocked = harness({ sessions: [session("ui", { backendSessionId: "thread" })], schedules: [ref] });
  await blocked.runner.run("archive", "ui");
  assert.deepEqual(blocked.log.invoked, []);
  assert.match(blocked.log.failures[0], /スケジュールがあります.*（CONVERSATION_HAS_SCHEDULES）$/);

  const stale = harness({ schedules: [{ id: "s", kind: "cron", sessionId: "a" }], refresh: async (state) => { state.schedules = []; } });
  await stale.runner.run("archive", "a");
  assert.deepEqual(stale.log.invoked, [["archive", "a"]]);
  assert.deepEqual(stale.log.failures, []);
});

test("heartbeat・一覧にない・除去済みの対象は何もしない", async () => {
  const h = harness({ sessions: [session("heartbeat-assistant:2026-11-12"), session("a")] });
  await h.runner.run("archive", "heartbeat-assistant:2026-11-12");
  await h.runner.run("archive", "missing");
  assert.deepEqual(h.log.invoked, []);
  await h.runner.run("archive", "a");
  await h.runner.run("archive", "a");
  assert.equal(h.log.invoked.length, 1);
});

test("IPC の失敗応答・Promise rejection は表示用に変換し、後処理しない", async () => {
  const failed = harness({ invoke: async () => ({ ok: false, error: { code: "CONVERSATION_DELETE_FAILED", message: "server" } }) });
  await failed.runner.run("delete", "a");
  assert.equal(failed.log.failures[0], "「title-a」を削除できません: server（CONVERSATION_DELETE_FAILED）");
  assert.deepEqual(failed.log.removed, []);
  assert.equal(failed.runner.isRemoved("a"), false);

  const rejected = harness({ invoke: async () => { throw new Error("ipc down"); } });
  await rejected.runner.run("archive", "a");
  assert.equal(rejected.log.failures[0], "「title-a」をアーカイブできません: ipc down（CONVERSATION_ARCHIVE_FAILED）");
  assert.deepEqual(rejected.log.removed, []);
  assert.equal(rejected.runner.isBusy("a"), false);
});

test("確認中に対象が消えた・backend ID が変わった場合は IPC を呼ばない", async () => {
  const gone = harness({ confirm: () => { gone.state.sessions = []; return true; } });
  await gone.runner.run("delete", "a");
  assert.deepEqual(gone.log.invoked, []);
  assert.match(gone.log.failures[0], /対象の会話は一覧にありません/);

  const changed = harness({ confirm: () => { changed.state.sessions = [session("a", { backendSessionId: "other" })]; return true; } });
  await changed.runner.run("delete", "a");
  assert.deepEqual(changed.log.invoked, []);
  assert.match(changed.log.failures[0], /CONVERSATION_UNAVAILABLE/);
});

test("連打しても backend 呼び出しは一度で、処理中は busy になり、新しい有効要求で失敗表示を消す", async () => {
  const gate = deferred();
  const h = harness({ sessions: [session("a"), session("b")], invoke: async () => { await gate.promise; return { ok: true }; } });
  const first = h.runner.run("archive", "a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.runner.isBusy("a"), true);
  await h.runner.run("archive", "a");
  await h.runner.run("delete", "a");
  assert.equal(h.log.invoked.length, 1);
  assert.equal(h.log.cleared, 1, "rejected duplicates must not clear the alert");
  const other = h.runner.run("archive", "b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.log.invoked.length, 2);
  gate.resolve();
  await Promise.all([first, other]);
  assert.deepEqual(h.log.busy.at(-1), []);
});

test("後処理が失敗しても backend は再実行せず、部分失敗として表示する", async () => {
  const h = harness();
  const runner = new actions.SessionActionRunner({
    findSession: (id) => h.state.sessions.find((s) => s.id === id), isRunning: () => false, getSchedules: () => [],
    refreshSchedules: async () => {}, confirm: () => true, invoke: async (...args) => { h.log.invoked.push(args); return { ok: true }; },
    onSuccess: () => { throw new Error("storage"); }, onFailure: (m) => h.log.failures.push(m), clearFailure() {}, onBusyChange() {}, onCancelled() {}
  });
  await runner.run("delete", "a");
  assert.equal(h.log.invoked.length, 1);
  assert.match(h.log.failures[0], /削除は完了しましたが、後処理に失敗しました: storage/);
  assert.equal(runner.isRemoved("a"), true);
});

test("chat-history: メニューは 名称変更→アーカイブ→削除 の button で、削除のみ danger、heartbeat には出さない", () => {
  const src = read("src/renderer/components/chat-history.ts");
  const menu = src.match(/<div class="dropdown"[\s\S]*?<\/div>\n\s*` : ""}/)[0];
  const buttons = [...menu.matchAll(/<button type="button" class="dropdown-item( danger)?"[^\n]*?\}>([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map((m) => [m[2], Boolean(m[1])]), [["名称変更", false], ["アーカイブ", false], ["削除", true]]);
  assert.doesNotMatch(menu, /<div class="dropdown-item/);
  assert.match(src, /hasMenu = !isHeartbeatAssistantSessionId\(session\.id\)/);
  assert.match(src, /!isEditing && hasMenu/);
  assert.match(src, /"archive-session"/);
  assert.match(src, /"delete-session"/);
  assert.match(src, /role="alert"/);
  assert.match(src, /dismiss-session-action-error/);
  assert.doesNotMatch(src, /setTimeout\([^)]*actionError/);
});

test("app: 共通後処理は選択解除の後に下書きを破棄し、preview invalidate は成功後だけ", () => {
  const app = read("src/renderer/app.ts");
  const body = app.match(/private _afterSessionRemoved[\s\S]*?\n  }\n/)[0];
  assert.ok(body.indexOf("_activateSession(null)") < body.indexOf("discardDraft"), "deselect must precede discardDraft");
  assert.match(body, /invalidate\(sessionId\)/);
  assert.match(body, /_navigationVersion/);
  assert.match(app, /backendSessions\.filter\(\(session\) => !this\._sessionActions\.isRemoved\(session\.id\)\)/, "_loadSessions must drop removed IDs");
  assert.doesNotMatch(app, /archiveConversation\(sessionId\)/);
  const composer = read("src/renderer/components/composer.ts");
  assert.match(composer, /discardDraft\(sessionId: string\)/);
});
