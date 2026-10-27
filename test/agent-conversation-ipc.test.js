const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({ listPlugins = async () => ({ ok: false }), submitPrompt = async () => ({ ok: true, text: "done" }) } = {}) {
  const handlers = new Map();
  const events = [];
  const aborted = [];
  const steered = [];
  const exported = {};
  const dependencies = {
    "node:crypto": require("node:crypto"),
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, BrowserWindow: { getFocusedWindow: () => ({}) } },
    "../ipc-contract": require("../dist/main/ipc-contract"),
    "../logger": { createLogger: () => ({ error() {} }) },
    "../plugin-mentions": { normalizePluginMentionsForPrompt: (text) => text },
    "./utils": { broadcastLoopEvent: (e) => events.push(e) }
  };
  vm.runInNewContext(fs.readFileSync("dist/main/ipc/agent-conversation.js", "utf8"), {
    exports: exported, require: (name) => {
      if (!dependencies[name]) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }
  });
  exported.registerAgentConversationIpcHandlers({
    agentRuntime: { submitPrompt, abort: (id) => aborted.push(id), steerPrompt: async (text, id) => { steered.push([text, id]); return { ok: true }; } },
    providerSettingsService: { getState: () => ({}) }, notificationService: {},
    pluginService: { listPlugins }, conversationHistory: {}
  });
  return { invoke: (name, payload) => handlers.get(name)(null, payload), events, aborted, steered };
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
