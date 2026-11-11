const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({ conversationHistory = {}, scheduler = { listSchedules: async () => [] }, running = () => false, listPlugins = async () => ({ ok: false }), submitPrompt = async () => ({ ok: true, text: "done" }) } = {}) {
  const handlers = new Map();
  const events = [];
  const aborted = [];
  const steered = [];
  const forgotten = [];
  const exported = {};
  const dependencies = {
    "node:crypto": require("node:crypto"),
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, BrowserWindow: { getFocusedWindow: () => ({}) } },
    "../ipc-contract": require("../dist/main/ipc-contract"),
    "../logger": { createLogger: () => ({ error() {} }) },
    "../plugin-mentions": { normalizePluginMentionsForPrompt: (text) => text },
    "../../shared/heartbeat-assistant": require("../dist/shared/heartbeat-assistant"),
    "./utils": { broadcastLoopEvent: (e) => events.push(e) }
  };
  vm.runInNewContext(fs.readFileSync("dist/main/ipc/agent-conversation.js", "utf8"), {
    exports: exported, require: (name) => {
      if (!dependencies[name]) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }
  });
  exported.registerAgentConversationIpcHandlers({
    agentRuntime: { submitPrompt, isConversationRunning: running, forgetConversation: (id) => forgotten.push(id), abort: (id) => aborted.push(id), steerPrompt: async (text, id) => { steered.push([text, id]); return { ok: true }; } },
    providerSettingsService: { getState: () => ({}) }, notificationService: {},
    pluginService: { listPlugins }, conversationHistory, scheduler
  });
  return { invoke: (name, payload) => handlers.get(name)(null, payload), events, aborted, steered, forgotten };
}

test("IPC はプラグイン準備中の会話も予約し、別会話は待たずに実行する", async () => {
  const plugins = deferred();
  const started = [];
  const ipc = setup({ listPlugins: () => plugins.promise, submitPrompt: async (_text, _settings, hooks) => { started.push(hooks.conversationId); return { ok: true, text: "done" }; } });
  const a = ipc.invoke("agent:submitPrompt", { text: "@plugin A", conversationId: "a" });
  const duplicate = await ipc.invoke("agent:submitPrompt", { text: "duplicate", conversationId: "a" });
  assert.equal(duplicate.error.code, "CONVERSATION_BUSY");
  assert.equal((await ipc.invoke("agent:submitPrompt", { text: "B", conversationId: "b" })).ok, true);
  assert.deepEqual(started, ["b"]);
  plugins.resolve({ ok: false });
  assert.equal((await a).ok, true);
  assert.deepEqual(started, ["b", "a"]);
  assert.equal(ipc.events.filter((e) => e.type === "run_start").length, 2);
});

test("IPC の中断は ID 必須で、指定会話のプラグイン準備と追加指示だけを止める", async () => {
  const plugins = deferred();
  let starts = 0;
  const ipc = setup({ listPlugins: () => plugins.promise, submitPrompt: async () => { starts++; return { ok: true, text: "done" }; } });
  const a = ipc.invoke("agent:submitPrompt", { text: "@plugin A", conversationId: "a" });
  const steer = ipc.invoke("agent:steerPrompt", { text: "additional", conversationId: "a" });
  for (const payload of [undefined, {}, { conversationId: 1 }, { conversationId: " " }]) {
    assert.equal(ipc.invoke("agent:abort", payload).ok, false);
  }
  assert.deepEqual(ipc.aborted, []);
  assert.equal(ipc.invoke("agent:abort", { conversationId: "a" }).ok, true);
  assert.equal((await steer).error.code, "NO_ACTIVE_TURN");
  assert.equal((await ipc.invoke("agent:submitPrompt", { text: "B", conversationId: "b" })).ok, true);
  assert.equal((await a).error.code, "ABORTED");
  plugins.resolve({ ok: false });
  assert.equal(starts, 1);
  assert.deepEqual(ipc.aborted, ["a"]);
  assert.deepEqual(ipc.steered, []);
});

test("IPC の追加指示は元の会話の準備完了を待って同じ実行へ届く", async () => {
  const plugins = deferred();
  const finish = deferred();
  let started = false;
  const ipc = setup({ listPlugins: () => plugins.promise, submitPrompt: async () => { started = true; await finish.promise; return { ok: true, text: "done" }; } });
  const a = ipc.invoke("agent:submitPrompt", { text: "@plugin A", conversationId: "a" });
  const steer = ipc.invoke("agent:steerPrompt", { text: "additional", conversationId: "a" });
  await Promise.resolve();
  assert.equal(started, false);
  assert.deepEqual(ipc.steered, []);
  plugins.resolve({ ok: false });
  assert.equal((await steer).ok, true);
  assert.equal(started, true);
  assert.deepEqual(ipc.steered, [["additional", "a"]]);
  finish.resolve();
  assert.equal((await a).ok, true);
});


test("履歴ページIPCは不正なカーソルを拒否し、取得方向とカーソルをそのまま渡す", async () => {
  const reads = [];
  const ipc = setup({ conversationHistory: { readConversation: async (...args) => {
    reads.push(args);
    return { id: "thread", messages: [], historyPage: { olderCursor: null, newerCursor: "back" } };
  } } });
  for (const page of [null, 1, { cursor: 1 }, { cursor: "x".repeat(16385) }, { direction: "sideways" }]) {
    const result = await ipc.invoke("conversations:read", { conversationId: "thread", page });
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
  assert.equal(reads.length, 0);
  const page = { cursor: "opaque-cursor", direction: "newer" };
  const result = await ipc.invoke("conversations:read", { conversationId: "thread", page });
  assert.equal(result.ok, true);
  assert.equal(reads[0][0], "thread");
  assert.equal(reads[0][1], page);
  assert.equal(result.conversation.historyPage.newerCursor, "back");
});


test("IPC forwards image-only input through normal submission", async () => {
  const images = [{ name: "clip.png", dataUrl: "data:image/png;base64,aGVsbG8=" }];
  let received;
  const ipc = setup({ submitPrompt: async (text, settings, hooks) => {
    received = { text, images: hooks.images };
    return { ok: true, text: "done" };
  } });
  assert.equal((await ipc.invoke("agent:submitPrompt", { text: "", images, conversationId: "a" })).ok, true);
  assert.equal(received.text, "");
  assert.deepEqual(received.images, images);
});

function removalFixture(overrides = {}) {
  const calls = [];
  const conversationHistory = {
    archiveConversation: async (id) => { calls.push(["archive", id]); },
    deleteConversation: async (id) => { calls.push(["delete", id]); },
    ...overrides.conversationHistory
  };
  return { calls, ipc: setup({ conversationHistory, ...overrides.setup }) };
}

for (const [channel, kind, failCode] of [["conversations:archive", "archive", "CONVERSATION_ARCHIVE_FAILED"], ["conversations:delete", "delete", "CONVERSATION_DELETE_FAILED"]]) {
  test(`${channel}: 成功時は thread を呼び、対象キャッシュを破棄する`, async () => {
    const { calls, ipc } = removalFixture();
    assert.deepEqual(JSON.parse(JSON.stringify(await ipc.invoke(channel, { conversationId: "t1" }))), { ok: true });
    assert.deepEqual(calls, [[kind, "t1"]]);
    assert.deepEqual([...ipc.forgotten], ["t1"]);
  });

  test(`${channel}: payload 不正は INVALID_REQUEST で backend を呼ばない`, async () => {
    const { calls, ipc } = removalFixture();
    for (const payload of [null, undefined, "x", {}, { conversationId: 1 }, { conversationId: "   " }]) {
      assert.equal((await ipc.invoke(channel, payload)).error.code, "INVALID_REQUEST");
    }
    assert.deepEqual(calls, []);
  });

  test(`${channel}: heartbeat ID は CONVERSATION_UNSUPPORTED`, async () => {
    const { calls, ipc } = removalFixture();
    for (const id of ["heartbeat-assistant", "heartbeat-assistant:2026-11-12"]) {
      assert.equal((await ipc.invoke(channel, { conversationId: id })).error.code, "CONVERSATION_UNSUPPORTED");
    }
    assert.deepEqual(calls, []);
  });

  test(`${channel}: 実行中は CONVERSATION_BUSY`, async () => {
    const { calls, ipc } = removalFixture({ setup: { running: (id) => id === "t1" } });
    assert.equal((await ipc.invoke(channel, { conversationId: "t1" })).error.code, "CONVERSATION_BUSY");
    assert.deepEqual(calls, []);
  });

  test(`${channel}: プラグイン準備中の会話は CONVERSATION_BUSY`, async () => {
    const plugins = deferred();
    const { calls, ipc } = removalFixture({ setup: { listPlugins: () => plugins.promise } });
    const run = ipc.invoke("agent:submitPrompt", { text: "@plugin A", conversationId: "t1" });
    assert.equal((await ipc.invoke(channel, { conversationId: "t1" })).error.code, "CONVERSATION_BUSY");
    assert.deepEqual(calls, []);
    plugins.resolve({ ok: false });
    await run;
  });

  test(`${channel}: スケジュール参照ありは CONVERSATION_HAS_SCHEDULES`, async () => {
    for (const kindOfSchedule of ["cron", "one_shot"]) {
      const { calls, ipc } = removalFixture({ setup: { scheduler: { listSchedules: async () => [{ id: "s", kind: kindOfSchedule, sessionId: "t1" }] } } });
      assert.equal((await ipc.invoke(channel, { conversationId: "t1" })).error.code, "CONVERSATION_HAS_SCHEDULES");
      assert.deepEqual(calls, []);
    }
  });

  test(`${channel}: 別会話のスケジュールは妨げない`, async () => {
    const { calls, ipc } = removalFixture({ setup: { scheduler: { listSchedules: async () => [{ id: "s", kind: "cron", sessionId: "other" }] } } });
    assert.equal((await ipc.invoke(channel, { conversationId: "t1" })).ok, true);
    assert.deepEqual(calls, [[kind, "t1"]]);
  });

  test(`${channel}: スケジュール確認失敗は拒否する`, async () => {
    const { calls, ipc } = removalFixture({ setup: { scheduler: { listSchedules: async () => { throw new Error("daemon down"); } } } });
    const result = await ipc.invoke(channel, { conversationId: "t1" });
    assert.equal(result.error.code, "CONVERSATION_SCHEDULE_CHECK_FAILED");
    assert.match(result.error.message, /daemon down/);
    assert.deepEqual(calls, []);
  });

  test(`${channel}: App Server の失敗は操作別コードで元の理由を保持し、キャッシュを破棄しない`, async () => {
    const { ipc } = removalFixture({ conversationHistory: { archiveConversation: async () => { throw new Error("boom"); }, deleteConversation: async () => { throw new Error("boom"); } } });
    const result = await ipc.invoke(channel, { conversationId: "t1" });
    // The handler runs in a vm realm, so `instanceof Error` is false and the message is stringified.
    assert.equal(result.ok, false);
    assert.equal(result.error.code, failCode);
    assert.match(result.error.message, /boom/);
    assert.deepEqual([...ipc.forgotten], []);
  });

  test(`${channel}: 同一 ID の重複要求は先行処理だけ実行し、別 ID は並行できる`, async () => {
    const gate = deferred();
    const { calls, ipc } = removalFixture({ conversationHistory: {
      archiveConversation: async (id) => { calls.push(["archive", id]); await gate.promise; },
      deleteConversation: async (id) => { calls.push(["delete", id]); await gate.promise; }
    } });
    const first = ipc.invoke(channel, { conversationId: "t1" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await ipc.invoke(channel, { conversationId: "t1" })).error.code, "CONVERSATION_BUSY");
    const other = ipc.invoke(channel, { conversationId: "t2" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [[kind, "t1"], [kind, "t2"]]);
    gate.resolve();
    assert.equal((await first).ok, true);
    assert.equal((await other).ok, true);
  });

  test(`${channel}: 除去済み ID への遅延操作は CONVERSATION_UNAVAILABLE`, async () => {
    const { calls, ipc } = removalFixture();
    await ipc.invoke(channel, { conversationId: "t1" });
    assert.equal((await ipc.invoke(channel, { conversationId: "t1" })).error.code, "CONVERSATION_UNAVAILABLE");
    assert.equal(calls.length, 1);
  });
}
