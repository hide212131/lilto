const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload は scheduler notification listener を公開する", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /onSchedulerNotification:\s*\(listener/);
  assert.match(content, /ipcRenderer\.on\(SCHEDULER_NOTIFICATION_CHANNEL, wrapped\)/);
  assert.match(content, /silent: options\?\.silent === true/);
  assert.match(content, /backendSessionId/);
  assert.match(content, /listSchedules:\s*async \(\)/);
  assert.match(content, /ipcRenderer\.invoke\("scheduler:list"\)/);
  assert.match(content, /deleteSchedule:\s*async \(id: string\)/);
  assert.match(content, /ipcRenderer\.invoke\("scheduler:delete", \{ id \}\)/);
  assert.match(content, /showSchedulerNotification/);
});

test("renderer app は backendSessionId または conversationId で scheduler notification を対応付ける", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /event\.type === "session_bound"/);
  assert.match(content, /event\.requestId === this\._activeRequestId/);
  assert.match(content, /event\.type === "run_start" && event\.conversationId === this\._pendingConversationId/);
  assert.match(content, /backendSessionId/);
  assert.match(content, /_onSchedulerNotification/);
  assert.match(content, /session\.backendSessionId === event\.sessionId/);
  assert.match(content, /session\.id === event\.sessionId/);
  assert.match(content, /followUpInstruction/);
  assert.match(content, /_runSchedulerFollowUp/);
  assert.match(content, /_runConditionalSchedulerFollowUp/);
  assert.match(content, /silent: true/);
  assert.match(content, /parseSchedulerNotificationDecision/);
  assert.match(content, /shouldRunConditionalSchedulerFollowUp/);
  assert.match(content, /buildConditionalSchedulerFollowUpPrompt/);
  assert.match(content, /activeSession\?\.backendSessionId/);
  assert.match(content, /session\?\.backendSessionId/);
  assert.match(content, /window\.lilto\.submitPrompt/);
  assert.match(content, /window\.lilto\.showSchedulerNotification/);
});

test("settings-modal は Schedules タブから schedule 一覧取得と削除を行える", () => {
  const content = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  assert.match(content, />Heartbeat<\/div>/);
  assert.match(content, />Instructions<\/div>/);
  assert.match(content, /既定では 30 分ごとに background patrol を実行し、問題がある時だけ表面化します/);
  assert.match(content, /id="heartbeat-interval-minutes"/);
  assert.match(content, /Heartbeat 設定を保存/);
  assert.match(content, /Project AGENTS\.md/);
  assert.match(content, /window\.lilto\.getAgentsFile\(\)/);
  assert.match(content, /window\.lilto\.openAgentsFile\(\)/);
  assert.match(content, /AGENTS\.md を標準エディタで開く/);
  assert.match(content, /window\.lilto\.getHeartbeatStatus\(\)/);
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
  assert.match(content, /isHeartbeatInternalScheduleId/);
  assert.match(content, /await scheduler\.listSchedules\(\)/);
  assert.match(content, /ipcMain\.handle\("scheduler:delete"/);
  assert.match(content, /await scheduler\.deleteSchedule/);
  assert.match(content, /ipcMain\.handle\("scheduler:showNotification"/);
  assert.match(content, /if \(!silent\)/);
});

test("renderer app は heartbeat assistant finding を専用セッションへ反映する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /HEARTBEAT_INTERNAL_SCHEDULE_ID/);
  assert.match(content, /HEARTBEAT_ASSISTANT_SESSION_ID/);
  assert.match(content, /isHeartbeatAssistantSessionId/);
  assert.match(content, /buildHeartbeatAssistantSessionTitle/);
  assert.match(content, /existingSession\?\.title \?\? "会話"/);
  assert.match(content, /_ensureHeartbeatSession/);
  assert.match(content, /Heartbeat assistant/);
  assert.match(content, /role: "assistant"/);
});
