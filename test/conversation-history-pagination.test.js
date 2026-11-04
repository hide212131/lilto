const test = require("node:test");
const assert = require("node:assert/strict");
const { ConversationHistoryService } = require("../dist/main/conversation-history.js");

const thread = (id, extra = {}) => ({ id, name: id, createdAt: 1700000000, ...extra });

function fixture(pages) {
  const service = new ConversationHistoryService({ workspaceDir: "/workspace" });
  const calls = [];
  let closed = false;
  service.createClient = async () => ({
    request: async (method, params) => {
      assert.equal(method, "thread/list");
      calls.push(params);
      const page = pages[calls.length - 1];
      assert.ok(page, "must stop at the last page");
      if (page instanceof Error) throw page;
      return page;
    },
    close: () => { closed = true; }
  });
  return { service, calls, isClosed: () => closed };
}

test("loads every page in server order, retaining filters and opaque cursors", async () => {
  const f = fixture([
    { data: [thread("newest")], nextCursor: "opaque/one+=" },
    { data: [thread("background", { serviceName: "lilto-background" })], nextCursor: "opaque-two" },
    { data: [], nextCursor: "opaque-three" },
    { data: [thread("oldest", { preview: "old preview", name: "" })], nextCursor: null }
  ]);
  const records = await f.service.listConversations();
  assert.deepEqual(records.map((r) => r.id), ["newest", "oldest"]);
  assert.equal(records[1].title, "old preview");
  assert.equal(records[1].createdAt, 1700000000000);
  assert.deepEqual(records[1].messages, []);
  const filters = { sourceKinds: ["vscode", "appServer"], archived: false, sortKey: "updated_at", cwd: "/workspace" };
  assert.deepEqual(f.calls, [filters, ...["opaque/one+=", "opaque-two", "opaque-three"].map((cursor) => ({ ...filters, cursor }))]);
  assert.equal(f.isClosed(), true);
});

test("empty history completes after one request", async () => {
  const f = fixture([{ data: [], nextCursor: null }]);
  assert.deepEqual(await f.service.listConversations(), []);
  assert.equal(f.calls.length, 1);
  assert.equal(f.isClosed(), true);
});

test("later page failure rejects instead of returning a partial history and closes the client", async () => {
  const f = fixture([{ data: [thread("first")], nextCursor: "next" }, new Error("page failed")]);
  await assert.rejects(f.service.listConversations(), /page failed/);
  assert.equal(f.isClosed(), true);
});

test("cursor cycles fail without looping forever and close the client", async () => {
  const f = fixture([
    { data: [], nextCursor: "one" },
    { data: [], nextCursor: "two" },
    { data: [], nextCursor: "one" }
  ]);
  await assert.rejects(f.service.listConversations(), /repeated.*cursor/);
  assert.equal(f.calls.length, 3);
  assert.equal(f.isClosed(), true);
});
