const test = require("node:test");
const assert = require("node:assert/strict");
const { ConversationHistoryWindow } = require("../dist/shared/conversation-history-window");
const { ConversationHistoryService } = require("../dist/main/conversation-history");

const page = (start, end) => ({
  messages: Array.from({ length: end - start }, (_, index) => ({ id: String(start + index) })),
  historyPage: { olderCursor: start ? `before-${start}` : null, newerCursor: `after-${end}` }
});

test("履歴は前後に往復しても最大3ページで、解放した範囲へ再取得できる", () => {
  const window = new ConversationHistoryWindow();
  window.reset(page(80, 100));
  for (let start = 60; start >= 0; start -= 20) window.add(page(start, start + 20), "older");
  assert.equal(window.messages.length, 60);
  assert.equal(window.messages[0].id, "0");
  assert.equal(window.messages.at(-1).id, "59");
  assert.equal(window.cursor("older"), null);
  assert.equal(window.cursor("newer"), "after-60");
  window.add(page(59, 79), "newer"); // Reverse cursors include their anchor.
  assert.equal(new Set(window.messages.map((message) => message.id)).size, window.messages.length);
  assert.equal(window.messages[0].id, "20");
  assert.equal(window.messages.at(-1).id, "78");
  assert.equal(window.cursor("older"), "before-20");
  window.reset();
  assert.deepEqual(window.messages, []);
  assert.equal(window.cursor("newer"), null);
});

test("最新と前後の取得はmetadata-only readと20ターンのページAPIを使う", async () => {
  const service = new ConversationHistoryService({ workspaceDir: process.cwd() });
  const requests = [];
  let closed = 0;
  service.createClient = async () => ({
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/read") return { thread: { id: "thread", createdAt: 1790000000 } };
      return { data: [3, 2].map((n) => ({ id: `t${n}`, startedAt: 1790000000 + n, completedAt: 1790000001 + n,
        items: [{ id: `m${n}`, type: "agentMessage", text: String(n) }] })), nextCursor: "next", backwardsCursor: "back" };
    },
    close: () => { closed += 1; }
  });
  const latest = await service.readConversation("thread");
  assert.deepEqual(latest.messages.map((message) => message.text), ["2", "3"]);
  assert.deepEqual(latest.historyPage, { olderCursor: "next", newerCursor: null });
  const older = await service.readConversation("thread", { cursor: "opaque", direction: "older" });
  assert.deepEqual(older.historyPage, { olderCursor: "next", newerCursor: "back" });
  const newer = await service.readConversation("thread", { cursor: "opaque", direction: "newer" });
  assert.deepEqual(newer.historyPage, { olderCursor: "back", newerCursor: "next" });
  for (const { method, params } of requests) {
    if (method === "thread/read") assert.equal(params.includeTurns, false);
    else {
      assert.equal(method, "thread/turns/list");
      assert.equal(params.limit, 20);
      assert.equal(params.itemsView, "full");
    }
  }
  assert.equal(requests.at(-1).params.sortDirection, "asc");
  assert.equal(closed, 3);
});

test("ページ取得の失敗時もApp Serverを閉じる", async () => {
  const service = new ConversationHistoryService({ workspaceDir: process.cwd() });
  let closed = false;
  service.createClient = async () => ({
    request: async (method) => {
      if (method === "thread/read") return { thread: { id: "thread" } };
      throw new Error("page failed");
    },
    close: () => { closed = true; }
  });
  await assert.rejects(service.readConversation("thread"), /page failed/);
  assert.equal(closed, true);
});
