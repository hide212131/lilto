const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload は scheduler notification listener を公開する", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /onSchedulerNotification:\s*\(listener/);
  assert.match(content, /ipcRenderer\.on\(SCHEDULER_NOTIFICATION_CHANNEL, wrapped\)/);
  assert.match(content, /listSchedules:\s*async \(\)/);
  assert.match(content, /ipcRenderer\.invoke\("scheduler:list"\)/);
  assert.match(content, /deleteSchedule:\s*async \(id: string\)/);
  assert.match(content, /ipcRenderer\.invoke\("scheduler:delete", \{ id \}\)/);
});

test("renderer app は backendSessionId または conversationId で scheduler notification を対応付ける", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /event\.type === "session_bound"/);
  assert.match(content, /backendSessionId/);
  assert.match(content, /_onSchedulerNotification/);
  assert.match(content, /session\.backendSessionId === event\.sessionId/);
  assert.match(content, /session\.id === event\.sessionId/);
  assert.match(content, /followUpInstruction/);
  assert.match(content, /_runSchedulerFollowUp/);
  assert.match(content, /window\.lilto\.submitPrompt/);
});

test("settings-modal は Schedules タブから schedule 一覧取得と削除を行える", () => {
  const content = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  assert.match(content, />Schedules<\/div>/);
  assert.match(content, /現在設定されている cron スケジュール/);
  assert.match(content, /window\.lilto\.listSchedules\(\)/);
  assert.match(content, /window\.lilto\.deleteSchedule\(id\)/);
  assert.match(content, /現在有効なスケジュールはありません。/);
  assert.match(content, /一覧取得エラー:/);
  assert.match(content, /削除エラー:/);
  assert.match(content, /スケジュール \$\{id\} を削除しました。/);
});

test("main ipc は scheduler 一覧取得と削除ハンドラを公開する", () => {
  const content = fs.readFileSync("src/main/ipc.ts", "utf8");
  assert.match(content, /ipcMain\.handle\("scheduler:list"/);
  assert.match(content, /await scheduler\.listSchedules\(\)/);
  assert.match(content, /ipcMain\.handle\("scheduler:delete"/);
  assert.match(content, /await scheduler\.deleteSchedule/);
});
