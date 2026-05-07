const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("scheduler-daemon は disabled row と同じ id の create を再有効化できる", () => {
  const content = fs.readFileSync("native/scheduler-daemon/src/main.rs", "utf8");
  assert.match(content, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(content, /enabled = 1/);
  assert.match(content, /SELECT EXISTS\(SELECT 1 FROM schedules WHERE id = \?1\)/);
});

test("scheduler-daemon は notification decision criteria を notification payload と summary へ含める", () => {
  const content = fs.readFileSync("native/scheduler-daemon/src/main.rs", "utf8");
  assert.match(content, /notification_decision_criteria: Option<String>/);
  assert.match(content, /notification_decision_criteria: record\.notification\.notification_decision_criteria\.clone\(\)/);
});