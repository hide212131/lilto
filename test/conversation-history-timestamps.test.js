const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ConversationHistoryService } = require("../dist/main/conversation-history.js");
const { augmentPromptForScheduler } = require("../dist/main/agent-sdk-config.js");

const createdAt = Date.parse("2026-10-22T01:00:00Z");
const user = (id, text) => ({ id, type: "userMessage", content: [{ text }] });
const agent = (id, text) => ({ id, type: "agentMessage", text });
const event = (timestamp, payload) => JSON.stringify({ type: "event_msg", timestamp, payload });

async function readHistory(t, turns, lines, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lilto-history-times-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rolloutPath = path.join(dir, "rollout.jsonl");
  if (lines) await fs.writeFile(rolloutPath, lines.join("\n"));
  const service = new ConversationHistoryService({ workspaceDir: dir });
  let closed = false;
  service.createClient = async () => ({
    request: async () => ({ thread: { id: "thread-times", createdAt: createdAt / 1000, path: rolloutPath, turns, ...extra } }),
    close: () => { closed = true; }
  });
  const history = await service.readConversation("thread-times");
  assert.equal(closed, true);
  return history.messages;
}

test("個別時刻のないAPI履歴を発言イベントの時刻で復元し、繰り返し発言もturnごとに対応させる", async (t) => {
  const turns = [
    { id: "turn-1", items: [user("item-1", "もう一度"), agent("item-2", "はい")] },
    { id: "turn-2", items: [user("item-10", "もう一度"), agent("item-20", "はい")] }
  ];
  const times = ["2026-10-22T01:01:00.125Z", "2026-10-22T01:03:00.500Z", "2026-10-23T02:00:00Z", "2026-10-23T02:04:00Z"];
  const messages = await readHistory(t, turns, [
    event(times[0], { type: "task_started", turn_id: "rolled-back-turn" }),
    event(times[0], { type: "user_message", message: "もう一度" }),
    event(times[0], { type: "task_started", turn_id: "turn-1" }),
    event(times[0], { type: "user_message", message: "もう一度" }),
    JSON.stringify({ type: "response_item", timestamp: times[0], payload: { type: "message", role: "assistant", content: [{ text: "はい" }] } }),
    event(times[1], { type: "agent_message", message: "はい" }),
    event(times[2], { type: "turn_started", turn_id: "turn-2" }),
    event(times[2], { type: "user_message", message: "もう一度" }),
    event(times[3], { type: "agent_message", message: "はい" }),
    '{"type":'
  ]);
  assert.deepEqual(messages.map(m => m.createdAt), times.map(Date.parse));
  assert.deepEqual(messages.map(m => m.id), ["item-1", "item-2", "item-10", "item-20"]);
});

test("turn内の同一文面も発言順に時刻を取得し、APIの明示時刻を優先する", async (t) => {
  const times = ["2026-10-22T01:01:00Z", "2026-10-22T01:02:00Z", "2026-10-22T01:03:00Z"];
  const messages = await readHistory(t, [{ id: "turn-1", items: [
    user("u", "質問"), { ...agent("a1", "回答"), createdAt: createdAt / 1000 + 90 }, agent("a2", "回答")
  ] }], [
    JSON.stringify({ type: "turn_context", payload: { turn_id: "turn-1" } }),
    event(times[0], { type: "user_message", message: "質問" }),
    event(times[1], { type: "agent_message", message: "回答" }),
    event(times[2], { type: "agent_message", message: "回答" })
  ]);
  assert.deepEqual(messages.map(m => m.createdAt), [Date.parse(times[0]), createdAt + 90_000, Date.parse(times[2])]);
});

test("内部scheduler指示を除いた本文でも元のユーザー時刻を復元する", async (t) => {
  const prompt = augmentPromptForScheduler("後で教えて");
  const time = "2026-10-23T03:00:00Z";
  const messages = await readHistory(t, [{ id: "turn-1", items: [user("u", prompt)] }], [
    event(time, { type: "task_started", turn_id: "turn-1" }),
    event(time, { type: "user_message", message: prompt })
  ]);
  assert.equal(messages[0].text, "後で教えて");
  assert.equal(messages[0].createdAt, Date.parse(time));
});

test("rolloutがない履歴も読み込め、無効な時刻は既存のturn時刻へフォールバックする", async (t) => {
  const turns = [{ id: "turn-1", createdAt: createdAt / 1000 + 60, items: [user("u", "質問")] }];
  const missing = await readHistory(t, turns);
  const invalid = await readHistory(t, turns, [
    event("invalid", { type: "user_message", message: "質問" }), "null", "{}"
  ]);
  assert.equal(missing[0].createdAt, createdAt + 60_000);
  assert.deepEqual(invalid, missing);
});

test("turn IDのない旧履歴も発言順に復元する", async (t) => {
  const times = ["2026-10-22T01:01:00Z", "2026-10-22T01:04:00Z"];
  const messages = await readHistory(t, [{ id: "legacy", items: [user("u", "質問"), agent("a", "回答")] }], [
    event(times[0], { type: "user_message", message: "質問" }),
    event(times[1], { type: "agent_message", message: "回答" })
  ]);
  assert.deepEqual(messages.map(m => m.createdAt), times.map(Date.parse));
});

test("Codex 0.163.0のstartedAt/completedAtを使い、rollout欠落時も全発言をスレッド作成時刻に戻さない", async (t) => {
  const firstStart = createdAt / 1000 + 120;
  const firstEnd = firstStart + 185;
  const secondStart = firstStart + 86400;
  const secondEnd = secondStart + 90;
  const turns = [
    { id: "t1", startedAt: firstStart, completedAt: firstEnd, durationMs: 185000,
      items: [user("u1", "質問"), agent("a1", "回答")] },
    { id: "t2", startedAt: secondStart, completedAt: secondEnd, durationMs: 90000,
      items: [user("u2", "質問"), agent("a2", "回答")] }
  ];
  for (const extra of [{ path: null }, {}]) {
    const messages = await readHistory(t, turns, undefined, extra);
    assert.deepEqual(messages.map(m => m.createdAt), [firstStart, firstEnd, secondStart, secondEnd].map(t => t * 1000));
    assert.deepEqual(messages.map(m => m.id), ["u1", "a1", "u2", "a2"]);
  }
});

test("rolloutの本文やturn IDが一致しない場合もAPI時刻を使う", async (t) => {
  const start = createdAt + 120000;
  const end = start + 185000;
  const turns = [{ id: "api-turn", startedAt: start, completedAt: end, items: [
    user("u", "質問"), agent("a", "回答")
  ] }];
  const messages = await readHistory(t, turns, [
    event("2026-10-22T01:01:00Z", { type: "task_started", turn_id: "other-turn" }),
    event("2026-10-22T01:01:00Z", { type: "user_message", message: "別の質問" })
  ]);
  assert.deepEqual(messages.map(m => m.createdAt), [start, end]);
});

test("進捗文は開始時刻、最終回答とエラーは終了時刻、実行中は開始時刻を使う", async (t) => {
  const start = createdAt / 1000 + 120;
  const end = start + 185;
  const messages = await readHistory(t, [
    { id: "t1", startedAt: start, completedAt: end, error: { message: "失敗" }, items: [
      user("u1", "質問"), { ...agent("c", "調べています"), phase: "commentary" },
      { ...agent("a", "回答"), phase: "final_answer" }
    ] },
    { id: "t2", startedAt: end + 60, completedAt: null, items: [user("u2", "次の質問"), agent("c2", "処理中")] }
  ]);
  assert.deepEqual(messages.map(m => m.createdAt), [start, start, end, end, end + 60, end + 60].map(t => t * 1000));
});

test("実際のCodex 0.163.0 API応答でも履歴ファイルに依存せず送信・完了時刻を復元する", async (t) => {
  const { thread } = require("./fixtures/codex-0.163-thread-read-timestamps.json");
  const messages = await readHistory(t, thread.turns, undefined, thread);
  assert.deepEqual(messages.map(m => m.createdAt), thread.turns.flatMap(t => [t.startedAt * 1000, t.completedAt * 1000]));
  assert.equal(new Set(messages.map(m => m.createdAt)).size, 4);
});
