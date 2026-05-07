const test = require("node:test");
const assert = require("node:assert/strict");

const { SchedulerService } = require("../dist/main/scheduler.js");

test("SchedulerService は notification decision criteria を daemon payload と summary で正規化する", () => {
  const scheduler = new SchedulerService({
    logger: { info() {}, error() {} },
    userDataDir: "/tmp/lilto-test-scheduler-service",
    onNotification() {}
  });

  const daemonPayload = scheduler.toDaemonSchedule({
    title: "criteria test",
    kind: "one_shot",
    runAt: "2026-05-08T00:00:00.000Z",
    notification: {
      sessionId: "session-1",
      message: "done",
      followUpInstruction: "summarize",
      notificationDecisionCriteria: "notify only on errors"
    }
  });

  assert.equal(daemonPayload.notification.notification_decision_criteria, "notify only on errors");

  const normalized = scheduler.normalizeSummaryFields({
    id: "cron-1",
    kind: "one_shot",
    run_at: "2026-05-08T00:00:00.000Z",
    timezone: "UTC",
    session_id: "session-1",
    notification_message: "done",
    follow_up_instruction: "summarize",
    notification_decision_criteria: "notify only on errors",
    next_run_at: "2026-05-08T00:00:00.000Z"
  });

  assert.equal(normalized.notificationDecisionCriteria, "notify only on errors");
  assert.equal(normalized.followUpInstruction, "summarize");
  assert.equal(normalized.notificationMessage, "done");
});