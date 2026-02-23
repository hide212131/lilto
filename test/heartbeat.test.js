const test = require("node:test");
const assert = require("node:assert/strict");

const { HeartbeatScheduler } = require("../dist/main/heartbeat.js");

test("ジョブ失敗時も後続ジョブが実行される", async () => {
  const logs = [];
  const logger = {
    info: (message, payload) => logs.push({ level: "info", message, payload }),
    error: (message, payload) => logs.push({ level: "error", message, payload })
  };

  const scheduler = new HeartbeatScheduler({ intervalMs: 1000, logger });
  let secondRan = false;

  scheduler.registerJob({
    id: "first",
    enabled: true,
    handler: async () => {
      throw new Error("boom");
    }
  });

  scheduler.registerJob({
    id: "second",
    enabled: true,
    handler: async () => {
      secondRan = true;
    }
  });

  await scheduler.runTick();

  assert.equal(secondRan, true);
  assert.ok(logs.some((entry) => entry.level === "error" && entry.message === "heartbeat_job_failed"));
});
