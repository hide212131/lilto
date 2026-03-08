const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload は scheduler notification listener を公開する", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /onSchedulerNotification:\s*\(listener/);
  assert.match(content, /ipcRenderer\.on\(SCHEDULER_NOTIFICATION_CHANNEL, wrapped\)/);
});

test("renderer app は backendSessionId で scheduler notification を対応付ける", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /event\.type === "session_bound"/);
  assert.match(content, /backendSessionId/);
  assert.match(content, /_onSchedulerNotification/);
  assert.match(content, /session\.backendSessionId === event\.sessionId/);
  assert.match(content, /followUpInstruction/);
  assert.match(content, /_runSchedulerFollowUp/);
  assert.match(content, /window\.lilto\.submitPrompt/);
});
