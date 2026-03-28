const test = require("node:test");
const assert = require("node:assert/strict");

const { createCronTool } = require("../dist/main/cron-tool.js");

function createCtx(sessionId = "agent-session-1") {
  return {
    sessionManager: {
      getSessionId() {
        return sessionId;
      }
    }
  };
}

function createSchedulerDouble() {
  let received = null;
  return {
    get received() {
      return received;
    },
    scheduler: {
      async start() {},
      async createSchedule(input) {
        received = input;
        return {
          id: "cron-1",
          title: input.title,
          kind: input.kind,
          runAt: input.runAt,
          cronExpr: input.cronExpr,
          timezone: input.timezone ?? "Asia/Tokyo",
          sessionId: input.notification.sessionId,
          notificationMessage: input.notification.message
        };
      },
      async listSchedules() { return []; },
      async updateSchedule(id, input) {
        received = { id, ...input };
        return {
          id,
          title: input.title,
          kind: input.kind,
          runAt: input.runAt,
          cronExpr: input.cronExpr,
          timezone: input.timezone ?? "Asia/Tokyo",
          sessionId: input.notification.sessionId,
          notificationMessage: input.notification.message
        };
      },
      async deleteSchedule() { throw new Error("not used"); }
    }
  };
}

test("cron tool set_timer は現在の agent sessionId を通知先に使う", async () => {
  const schedulerDouble = createSchedulerDouble();
  const tool = await createCronTool({
    scheduler: schedulerDouble.scheduler,
    logger: { info() {}, error() {} }
  });

  const before = Date.now();
  const result = await tool.execute("call-1", {
    operation: "set_timer",
    title: "3分タイマー",
    afterSeconds: 180,
    notificationMessage: "3分たちました。",
    followUpInstruction: "alpha.co.jp を開きます"
  }, undefined, undefined, createCtx("session-xyz"));
  const after = Date.now();

  assert.equal(schedulerDouble.received.notification.sessionId, "session-xyz");
  assert.equal(schedulerDouble.received.notification.message, "3分たちました。");
  assert.equal(schedulerDouble.received.notification.followUpInstruction, "alpha.co.jp を開きます");
  const runAtMs = Date.parse(schedulerDouble.received.runAt);
  assert.ok(Number.isFinite(runAtMs));
  assert.ok(runAtMs >= before + 179000);
  assert.ok(runAtMs <= after + 181000);
  assert.match(result.content[0].text, /Created schedule/);
});

test("cron tool set_daily_reminder は hour/minute から日次 cron を生成する", async () => {
  const schedulerDouble = createSchedulerDouble();
  const tool = await createCronTool({
    scheduler: schedulerDouble.scheduler,
    logger: { info() {}, error() {} }
  });

  await tool.execute("call-2", {
    operation: "set_daily_reminder",
    title: "朝会",
    hour: 9,
    minute: 30,
    timezone: "Asia/Tokyo",
    notificationMessage: "朝会です。"
  }, undefined, undefined, createCtx("session-a"));

  assert.equal(schedulerDouble.received.kind, "cron");
  assert.equal(schedulerDouble.received.cronExpr, "0 30 9 * * *");
  assert.equal(schedulerDouble.received.timezone, "Asia/Tokyo");
  assert.equal(schedulerDouble.received.notification.sessionId, "session-a");
});

test("cron tool set_reminder_at は date/time/timezone から RFC3339 を組み立てる", async () => {
  const schedulerDouble = createSchedulerDouble();
  const tool = await createCronTool({
    scheduler: schedulerDouble.scheduler,
    logger: { info() {}, error() {} }
  });

  await tool.execute("call-3", {
    operation: "set_reminder_at",
    title: "病院",
    date: "2026-03-10",
    time: "09:15",
    timezone: "Asia/Tokyo",
    notificationMessage: "病院の時間です。"
  }, undefined, undefined, createCtx("session-b"));

  assert.equal(schedulerDouble.received.kind, "one_shot");
  assert.equal(schedulerDouble.received.runAt, "2026-03-10T09:15:00+09:00");
  assert.equal(schedulerDouble.received.notification.sessionId, "session-b");
});

test("cron tool create は低水準 API をフォールバックとして残す", async () => {
  const schedulerDouble = createSchedulerDouble();
  const tool = await createCronTool({
    scheduler: schedulerDouble.scheduler,
    logger: { info() {}, error() {} }
  });

  await tool.execute("call-4", {
    operation: "create",
    title: "複雑な繰り返し",
    kind: "cron",
    cronExpr: "0 15 10 * * 1-5",
    timezone: "Asia/Tokyo"
  }, undefined, undefined, createCtx("session-c"));

  assert.equal(schedulerDouble.received.kind, "cron");
  assert.equal(schedulerDouble.received.cronExpr, "0 15 10 * * 1-5");
  assert.equal(schedulerDouble.received.notification.sessionId, "session-c");
});

test("cron tool create は 5 field cron を 6 field へ正規化する", async () => {
  const schedulerDouble = createSchedulerDouble();
  const tool = await createCronTool({
    scheduler: schedulerDouble.scheduler,
    logger: { info() {}, error() {} }
  });

  await tool.execute("call-4b", {
    operation: "create",
    title: "毎分こんちは",
    kind: "cron",
    cronExpr: "*/1 * * * *",
    timezone: "Asia/Tokyo"
  }, undefined, undefined, createCtx("session-d"));

  assert.equal(schedulerDouble.received.kind, "cron");
  assert.equal(schedulerDouble.received.cronExpr, "0 */1 * * * *");
  assert.equal(schedulerDouble.received.notification.sessionId, "session-d");
});

test("cron tool list はデフォルトで現在 session の予定だけ返す", async () => {
  const tool = await createCronTool({
    scheduler: {
      async start() {},
      async createSchedule() { throw new Error("not used"); },
      async listSchedules() {
        return [
          {
            id: "mine",
            kind: "one_shot",
            runAt: "2026-03-08T12:03:00Z",
            timezone: "UTC",
            sessionId: "session-a",
            notificationMessage: "mine"
          },
          {
            id: "other",
            kind: "one_shot",
            runAt: "2026-03-08T12:04:00Z",
            timezone: "UTC",
            sessionId: "session-b",
            notificationMessage: "other"
          }
        ];
      },
      async updateSchedule() { throw new Error("not used"); },
      async deleteSchedule() { throw new Error("not used"); }
    },
    logger: { info() {}, error() {} }
  });

  const result = await tool.execute("call-5", { operation: "list" }, undefined, undefined, createCtx("session-a"));
  assert.match(result.content[0].text, /mine/);
  assert.doesNotMatch(result.content[0].text, /other/);
  assert.equal(result.details.items.length, 1);
});
