const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeSessionMessages } = require("../dist/shared/conversation-message-merge.js");
const { ConversationHistoryService } = require("../dist/main/conversation-history.js");

const timestamp = 1_792_600_000_000;
const message = (id, role, text, createdAt = timestamp) => ({ id, role, text, createdAt });
const conversation = () => [
  message("item-1", "user", "質問1"),
  message("item-2", "assistant", "回答1"),
  message("item-10", "user", "質問2"),
  message("item-20", "assistant", "回答2")
];

test("同時刻・桁数の異なるIDでも質問と回答の保存順を維持する", () => {
  const hydrated = conversation();
  const local = hydrated.map((entry, index) => ({ ...entry, id: `msg-${index + 1}`, createdAt: timestamp + 500 }));
  assert.deepEqual(mergeSessionMessages(hydrated, local), hydrated);
});

test("逆転した時刻やランダムなIDも保存された順序を変えない", () => {
  const hydrated = conversation().map((entry, index) => ({
    ...entry, id: ["z", "b", "a", "c"][index], createdAt: timestamp - index * 1000
  }));
  assert.deepEqual(mergeSessionMessages(hydrated, hydrated), hydrated);
  assert.deepEqual(mergeSessionMessages(hydrated, []), hydrated);
});

test("既に順序が崩れたローカル履歴は保存済みの会話順で復元する", () => {
  const hydrated = conversation();
  const local = [hydrated[0], hydrated[2], hydrated[1], hydrated[3]];
  assert.deepEqual(mergeSessionMessages(hydrated, local), hydrated);
});

test("local-only通知と未保存の質問・回答を保持し、再読込でも重複しない", () => {
  const hydrated = conversation();
  const notification = message("notice", "assistant", "通知", timestamp + 10_000);
  const pendingQuestion = message("msg-100", "user", "質問3", timestamp + 20_000);
  const pendingAnswer = { ...message("msg-101", "assistant", "処理中", timestamp + 20_001), pending: true };
  const local = [...hydrated.slice(0, 2), notification, ...hydrated.slice(2), pendingQuestion, pendingAnswer];
  const merged = mergeSessionMessages(hydrated, local);
  assert.deepEqual(merged, local);
  assert.deepEqual(mergeSessionMessages(hydrated, merged), local);
  assert.deepEqual(hydrated, conversation());
});

test("同じIDなら時刻と本文が更新されても保存側を採用する", () => {
  const hydrated = conversation();
  const local = hydrated.map((entry) => ({ ...entry, createdAt: timestamp + 60_000, text: `${entry.text}（古い表示）` }));
  assert.deepEqual(mergeSessionMessages(hydrated, local), hydrated);
});

test("同一文面の質問を繰り返しても保存済みメッセージを失わない", () => {
  const hydrated = [
    message("item-1", "user", "もう一度"),
    message("item-2", "assistant", "はい"),
    message("item-10", "user", "もう一度"),
    message("item-20", "assistant", "はい")
  ];
  const local = hydrated.map((entry, index) => ({ ...entry, id: `msg-${index}`, createdAt: timestamp + 500 }));
  assert.deepEqual(mergeSessionMessages(hydrated, local), hydrated);
});

test("保存履歴が空でもlocal-onlyメッセージの順序を維持する", () => {
  const local = conversation();
  assert.deepEqual(mergeSessionMessages([], local), local);
});

test("個別時刻のないApp Server履歴を読み直しても質問・回答の順序を維持する", async () => {
  const expected = conversation();
  const service = new ConversationHistoryService({ workspaceDir: process.cwd() });
  let closed = false;
  service.createClient = async () => ({
    request: async (method, params) => {
      assert.equal(method, "thread/read");
      assert.equal(params.includeTurns, true);
      const items = expected.map(({ id, role, text }) => role === "user"
        ? { id, type: "userMessage", content: [{ text }] }
        : { id, type: "agentMessage", text });
      return { thread: {
        id: "thread-order-test", createdAt: timestamp / 1000,
        turns: [{ id: "turn-1", items: items.slice(0, 2) }, { id: "turn-2", items: items.slice(2) }]
      } };
    },
    close: () => { closed = true; }
  });
  const record = await service.readConversation("thread-order-test");
  assert.equal(closed, true);
  assert.deepEqual(record.messages, expected);
  let local = expected.map((entry, index) => ({ ...entry, id: `msg-${index}`, createdAt: timestamp + 500 }));
  for (let refresh = 0; refresh < 3; refresh += 1) {
    local = mergeSessionMessages(record.messages, local);
    assert.deepEqual(local.map(({ text }) => text), ["質問1", "回答1", "質問2", "回答2"]);
  }
});
