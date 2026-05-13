const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  HeartbeatAssistantService
} = require("../dist/main/heartbeat-assistant.js");
const {
  HEARTBEAT_INTERNAL_SCHEDULE_ID,
  HEARTBEAT_ASSISTANT_SESSION_PREFIX
} = require("../dist/shared/heartbeat-assistant.js");

function createProviderSettings(overrides = {}) {
  return {
    activeProvider: "oauth",
    oauthProvider: "openai-codex",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "OpenAI API Key",
      baseUrl: "",
      apiKey: "",
      modelId: "gpt-5.3-codex"
    },
    networkProxy: {
      useProxy: false
    },
    windowsSandbox: {
      mode: "off",
      privateDesktop: true
    },
    chatSettings: {
      enterToSend: false,
      globalShortcut: "CommandOrControl+L"
    },
    heartbeatSettings: {
      enabled: true,
      filePath: "",
      intervalMinutes: 30,
      showDesktopNotifications: true
    },
    updatedAt: Date.now(),
    ...overrides
  };
}

function createService({ providerSettings, runtimeResult, listSchedules = [] }) {
  const notifications = [];
  const schedulerCalls = [];
  const runtimeCalls = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-heartbeat-"));
  const service = new HeartbeatAssistantService({
    logger: { info() {}, error() {} },
    scheduler: {
      async listSchedules() {
        schedulerCalls.push({ type: "list" });
        return listSchedules;
      },
      async createSchedule(input) {
        schedulerCalls.push({ type: "create", input });
        return { id: input.id, ...input, sessionId: input.notification.sessionId, notificationMessage: input.notification.message };
      },
      async updateSchedule(id, input) {
        schedulerCalls.push({ type: "update", id, input });
        return { id, ...input, sessionId: input.notification.sessionId, notificationMessage: input.notification.message };
      },
      async deleteSchedule(id) {
        schedulerCalls.push({ type: "delete", id });
      },
      async start() {}
    },
    agentRuntime: {
      async submitPrompt(...args) {
        runtimeCalls.push(args);
        return runtimeResult();
      }
    },
    notificationService: {
      notify(title, body) {
        notifications.push({ title, body });
      },
      incrementBadge() {
        notifications.push({ badge: true });
      }
    },
    userDataDir,
    getProviderSettings: () => providerSettings,
    broadcastNotification(event) {
      notifications.push({ event });
    },
    getFocusedWindow: () => null
  });
  return { service, notifications, schedulerCalls, runtimeCalls, userDataDir };
}

test("syncManagedSchedule は 30 分既定の internal schedule を作成する", async () => {
  const providerSettings = createProviderSettings();
  const { service, schedulerCalls } = createService({
    providerSettings,
    runtimeResult: async () => ({ ok: true, text: "HEARTBEAT_OK" })
  });

  await service.syncManagedSchedule(providerSettings);

  assert.equal(schedulerCalls[0].type, "list");
  assert.equal(schedulerCalls[1].type, "create");
  assert.equal(schedulerCalls[1].input.id, HEARTBEAT_INTERNAL_SCHEDULE_ID);
  assert.equal(schedulerCalls[1].input.notification.sessionId, HEARTBEAT_INTERNAL_SCHEDULE_ID);
  assert.equal(schedulerCalls[1].input.cronExpr, "0 */30 * * * *");
});

test("runPatrol は空の HEARTBEAT.md で model 実行をスキップする", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-heartbeat-"));
  const heartbeatPath = path.join(tempDir, "HEARTBEAT.md");
  fs.writeFileSync(heartbeatPath, "   \n", "utf8");
  let runtimeCalls = 0;
  const providerSettings = createProviderSettings({
    heartbeatSettings: {
      enabled: true,
      filePath: heartbeatPath,
      intervalMinutes: 30,
      showDesktopNotifications: true
    }
  });
  const { service } = createService({
    providerSettings,
    runtimeResult: async () => {
      runtimeCalls += 1;
      return { ok: true, text: "unexpected" };
    }
  });

  await service.runPatrol();

  assert.equal(runtimeCalls, 0);
  assert.equal(service.getStatus().level, "empty");
});

test("runPatrol は HEARTBEAT_OK のとき user-facing notification を追加せず state を heartbeat_state.json へ書く", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-heartbeat-"));
  const heartbeatPath = path.join(tempDir, "HEARTBEAT.md");
  fs.writeFileSync(heartbeatPath, "check quietly", "utf8");
  const providerSettings = createProviderSettings({
    heartbeatSettings: {
      enabled: true,
      filePath: heartbeatPath,
      intervalMinutes: 30,
      showDesktopNotifications: true
    }
  });
  const { service, notifications, userDataDir } = createService({
    providerSettings,
    runtimeResult: async () => ({ ok: true, text: "HEARTBEAT_OK" })
  });

  await service.runPatrol();

  const broadcastEvents = notifications.filter((entry) => entry.event);
  assert.equal(broadcastEvents.length, 0);
  const state = JSON.parse(fs.readFileSync(path.join(userDataDir, "heartbeat_state.json"), "utf8"));
  assert.equal(state.version, 1);
  assert.equal(typeof state.lastChecks.patrol, "number");
  assert.equal(service.getStatus().level, "ok");
});

test("runPatrol は heartbeat session に結果を書き戻しつつ model 実行は fresh context で行う", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-heartbeat-"));
  const heartbeatPath = path.join(tempDir, "HEARTBEAT.md");
  fs.writeFileSync(heartbeatPath, "check quietly", "utf8");
  const providerSettings = createProviderSettings({
    heartbeatSettings: {
      enabled: true,
      filePath: heartbeatPath,
      intervalMinutes: 30,
      showDesktopNotifications: true
    }
  });
  const { service, runtimeCalls } = createService({
    providerSettings,
    runtimeResult: async () => ({ ok: true, text: "HEARTBEAT_OK" })
  });

  await service.runPatrol();

  assert.equal(runtimeCalls.length, 1);
  const [_prompt, _settings, hooks] = runtimeCalls[0];
  assert.match(hooks.conversationId, new RegExp(`^${HEARTBEAT_ASSISTANT_SESSION_PREFIX}`));
  assert.equal(hooks.freshContext, true);
  assert.equal(hooks.mode, "heartbeat");
});

test("runPatrol は stable key で duplicate finding の再通知を抑制する", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-heartbeat-"));
  const heartbeatPath = path.join(tempDir, "HEARTBEAT.md");
  fs.writeFileSync(heartbeatPath, "check quietly", "utf8");
  const providerSettings = createProviderSettings({
    heartbeatSettings: {
      enabled: true,
      filePath: heartbeatPath,
      intervalMinutes: 30,
      showDesktopNotifications: false
    }
  });
  const { service, notifications } = createService({
    providerSettings,
    runtimeResult: async () => ({
      ok: true,
      text: "KEY: message:slack-3\nCHECK: messages\nMESSAGE: Slack の未読が 3 件あります。"
    })
  });

  await service.runPatrol();
  await service.runPatrol();

  const broadcastEvents = notifications.filter((entry) => entry.event);
  assert.equal(broadcastEvents.length, 1);
  assert.match(broadcastEvents[0].event.message, /Slack の未読/);
  assert.equal(service.getStatus().level, "finding");
});

test("runPatrol は旧 heartbeat-assistant-state.json を互換読込して新 state schema へ移行する", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-heartbeat-"));
  const heartbeatPath = path.join(tempDir, "HEARTBEAT.md");
  fs.writeFileSync(heartbeatPath, "check quietly", "utf8");
  const providerSettings = createProviderSettings({
    heartbeatSettings: {
      enabled: true,
      filePath: heartbeatPath,
      intervalMinutes: 30,
      showDesktopNotifications: false
    }
  });
  const { service, notifications, userDataDir } = createService({
    providerSettings,
    runtimeResult: async () => ({
      ok: true,
      text: "KEY: message:legacy-1\nCHECK: messages\nMESSAGE: legacy finding"
    })
  });
  fs.writeFileSync(
    path.join(userDataDir, "heartbeat-assistant-state.json"),
    JSON.stringify({
      lastRunAt: "2026-03-30T00:00:00.000Z",
      lastFindingFingerprint: "message:legacy-1",
      lastNotifiedAt: "2026-03-30T00:05:00.000Z"
    }),
    "utf8"
  );

  await service.runPatrol();

  const broadcastEvents = notifications.filter((entry) => entry.event);
  assert.equal(broadcastEvents.length, 0);
  const migrated = JSON.parse(fs.readFileSync(path.join(userDataDir, "heartbeat_state.json"), "utf8"));
  assert.equal(migrated.version, 1);
  assert.equal(typeof migrated.lastNotified["message:legacy-1"], "number");
});