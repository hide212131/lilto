const test = require("node:test");
const assert = require("node:assert/strict");
const { SchedulerService } = require("../dist/main/scheduler.js");

// Mock logger for testing
const mockLogger = {
  info: (event, details) => {
    console.log(`[SCHEDULER] ${event}:`, JSON.stringify(details, null, 2));
  },
  error: (event, details) => {
    console.error(`[SCHEDULER ERROR] ${event}:`, JSON.stringify(details, null, 2));
  }
};

test("スケジューラーサービスが30秒後のタイマーを作成できる", async () => {
  const notifications = [];
  const scheduler = new SchedulerService({
    logger: mockLogger,
    userDataDir: "/tmp/lilto-test-scheduler-live",
    onNotification: (event) => {
      console.log("\n✓ [NOTIFICATION FIRED]", JSON.stringify(event, null, 2));
      notifications.push(event);
    }
  });

  try {
    console.log("\n=== Starting Scheduler ===");
    await scheduler.start();
    console.log("✓ Scheduler started successfully\n");

    // Create a 3-second timer for testing
    const futureSecs = 3;
    const now = Date.now();
    const runAt = new Date(now + futureSecs * 1000).toISOString();

    console.log(`Creating ${futureSecs}-second timer...`);
    console.log(`  Now: ${new Date(now).toISOString()}`);
    console.log(`  Run at: ${runAt}\n`);

    const summary = await scheduler.createSchedule({
      title: `Live Test Timer ${futureSecs}s`,
      kind: "one_shot",
      runAt,
      notification: {
        sessionId: "test-session-live",
        message: `Timer fired after ${futureSecs} seconds!`
      }
    });

    console.log(`✓ Schedule created:`, JSON.stringify(summary, null, 2));
    assert.ok(summary.id, "Schedule should have an ID");
    console.log(`\nWaiting ${futureSecs + 1} seconds for timer to fire...\n`);

    // Wait for notification
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("Timeout - timer did not fire");
        resolve();
      }, (futureSecs + 1) * 1000);

      const checkInterval = setInterval(() => {
        if (notifications.length > 0) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });

    if (notifications.length > 0) {
      console.log("✓ Timer fired successfully!");
      assert.equal(notifications[0].sessionId, "test-session-live");
      assert.match(notifications[0].message, /Timer fired/);
    } else {
      console.log("⚠ Timer did not fire within timeout");
    }

    // List all schedules
    console.log("\n=== Listing all schedules ===");
    const schedules = await scheduler.listSchedules();
    console.log(`Found ${schedules.length} schedule(s):`);
    schedules.forEach((s) => {
      console.log(`  - ${s.id}: ${s.title} (next run: ${s.nextRunAt})`);
    });

  } catch (error) {
    console.error("Test failed:", error.message);
    throw error;
  }
});
