const test = require("node:test");
const assert = require("node:assert/strict");
const { ConversationHistoryService } = require("../dist/main/conversation-history.js");

function fixture(failure) {
  const service = new ConversationHistoryService({ workspaceDir: "/workspace" });
  const state = { calls: [], closed: 0 };
  service.createClient = async () => ({
    request: async (method, params) => {
      state.calls.push([method, params]);
      if (failure) throw failure;
      return {};
    },
    close: () => { state.closed += 1; }
  });
  return { service, state };
}

for (const [name, method, rpc] of [["archive", "archiveConversation", "thread/archive"], ["delete", "deleteConversation", "thread/delete"]]) {
  test(`${name} は ${rpc} を正しい threadId で呼び、成功時に client を閉じる`, async () => {
    const { service, state } = fixture();
    await service[method]("thread-1");
    assert.deepEqual(state.calls, [[rpc, { threadId: "thread-1" }]]);
    assert.equal(state.closed, 1);
  });

  test(`${name} の失敗は伝播し、client を閉じる`, async () => {
    const { service, state } = fixture(new Error("server said no"));
    await assert.rejects(() => service[method]("thread-1"), /server said no/);
    assert.equal(state.closed, 1);
  });
}
