const test = require("node:test");
const assert = require("node:assert/strict");

const { formatMessageTimestamp } = require("../dist/shared/format-message-timestamp.js");

test("当日の message timestamp は 24 時間表記の時刻だけを返す", () => {
  const now = new Date(2026, 4, 26, 14, 5).getTime();
  const createdAt = new Date(2026, 4, 26, 9, 7).getTime();

  assert.equal(formatMessageTimestamp(createdAt, now), "09:07");
});

test("非当日の message timestamp は月日と時刻を返す", () => {
  const now = new Date(2026, 4, 26, 14, 5).getTime();
  const createdAt = new Date(2026, 4, 25, 23, 15).getTime();

  assert.equal(formatMessageTimestamp(createdAt, now), "5/25 23:15");
});

test("日付境界をまたぐ message timestamp は前日扱いになる", () => {
  const now = new Date(2026, 4, 26, 0, 5).getTime();
  const createdAt = new Date(2026, 4, 25, 23, 59).getTime();

  assert.equal(formatMessageTimestamp(createdAt, now), "5/25 23:59");
});