const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConditionalSchedulerFollowUpPrompt,
  parseSchedulerNotificationDecision,
  shouldRunConditionalSchedulerFollowUp
} = require("../dist/shared/scheduler-follow-up.js");

test("conditional scheduler follow-up は followUpInstruction と criteria の両方があるときだけ有効になる", () => {
  assert.equal(shouldRunConditionalSchedulerFollowUp({
    id: "cron-1",
    sessionId: "session-1",
    message: "done",
    followUpInstruction: "alpha.co.jp を開く",
    notificationDecisionCriteria: "エラー時だけ通知する",
    firedAt: "2026-05-08T00:00:00.000Z"
  }), true);

  assert.equal(shouldRunConditionalSchedulerFollowUp({
    id: "cron-2",
    sessionId: "session-1",
    message: "done",
    followUpInstruction: "alpha.co.jp を開く",
    firedAt: "2026-05-08T00:00:00.000Z"
  }), false);
});

test("conditional scheduler follow-up prompt は判断基準と JSON 応答契約を含む", () => {
  const prompt = buildConditionalSchedulerFollowUpPrompt({
    id: "cron-1",
    sessionId: "session-1",
    message: "30秒経過しました。",
    followUpInstruction: "alpha.co.jp を開いて結果を確認する",
    notificationDecisionCriteria: "異常がある時だけ通知する",
    firedAt: "2026-05-08T00:00:00.000Z"
  });

  assert.match(prompt, /通知判断基準: 異常がある時だけ通知する/);
  assert.match(prompt, /JSON オブジェクトのみを返してください/);
  assert.match(prompt, /"shouldNotify":true/);
});

test("parseSchedulerNotificationDecision は shouldNotify=false を静かな終了として解釈する", () => {
  const parsed = parseSchedulerNotificationDecision('{"shouldNotify":false,"userMessage":""}');
  assert.deepEqual(parsed, {
    shouldNotify: false,
    userMessage: "スケジュールの処理が完了しました。"
  });
});

test("parseSchedulerNotificationDecision は JSON 以外を reject する", () => {
  assert.equal(parseSchedulerNotificationDecision("処理は終わりました"), null);
});