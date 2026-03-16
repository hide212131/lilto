import path from "node:path";
import { app, BrowserWindow } from "electron";

import { AgentRuntime } from "./agent-sdk";
import { ClaudeAuthService } from "./auth-service";
import { readConfig } from "./config";
import { registerAppShortcut, unregisterAppShortcut } from "./global-shortcut";
import { HeartbeatScheduler } from "./heartbeat";
import { SCHEDULER_NOTIFICATION_CHANNEL } from "./ipc-contract";
import { registerAgentIpcHandlers } from "./ipc";
import { createLogger } from "./logger";
import { NotificationService } from "./notifications";
import { ProviderSettingsService } from "./provider-settings";
import { ModelCatalogService } from "./model-catalog";
import { SchedulerService } from "./scheduler";
import { SchedulerUnavailableError } from "./scheduler";
import { SchedulerBridgeServer } from "./scheduler-bridge";
import { resolveCodexHomeDir, setupSkillRuntime } from "./skill-runtime";
import { WindowsSandboxSetupService } from "./windows-sandbox-setup";
import { createCliCompatibilityMap } from "./command-compat";
import { resolveAppIcon, resolveWindowIcon } from "./icon-assets";
import type { SchedulerNotificationEvent } from "../shared/scheduler";

const config = readConfig();
const logger = createLogger("main");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let schedulerBridge: SchedulerBridgeServer | null = null;

const notificationService = new NotificationService();

let authService: ClaudeAuthService | null = null;
const providerSettingsService = new ProviderSettingsService({ logger: createLogger("providers") });

function broadcastSchedulerNotification(event: SchedulerNotificationEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SCHEDULER_NOTIFICATION_CHANNEL, event);
  }
}

const heartbeat = new HeartbeatScheduler({
  intervalMs: config.heartbeatIntervalMs,
  logger: createLogger("heartbeat")
});

heartbeat.registerJob({
  id: "health-log",
  enabled: true,
  handler: async () => {
    logger.info("heartbeat_health", { at: new Date().toISOString() });
  }
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(process.cwd(), "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: config.appName
  });

  void mainWindow.loadFile(path.join(process.cwd(), "dist", "renderer", "index.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // ウインドウがフォーカスされたら未読バッジをクリアする
  mainWindow.on("focus", () => {
    notificationService.clearBadge();
  });
}

function showAndFocusMainWindow(): void {
  if (!mainWindow) {
    if (app.isReady()) {
      createWindow();
    }
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showAndFocusMainWindow();
  });
}

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      const dockIcon = resolveAppIcon(512);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }

    logger.info("cli_compatibility_resolved", {
      platform: process.platform,
      commands: createCliCompatibilityMap()
    });

    let skillRuntime;
    try {
      skillRuntime = setupSkillRuntime({
        appDataDir: app.getPath("userData"),
        projectName: path.basename(process.cwd()),
        workspaceTtlHours: Number(process.env.LILTO_WORKSPACE_TTL_HOURS || 24 * 7)
      });
      logger.info("skill_runtime_initialized", {
        appSkillsDir: skillRuntime.appSkillsDir,
        bundledSkillsDir: skillRuntime.bundledSkillsDir,
        userSkillsDir: skillRuntime.userSkillsDir,
        workspaceDir: skillRuntime.workspaceDir,
        skills: skillRuntime.availableSkills.map((skill) => skill.name),
        updatedSettings: skillRuntime.updatedSettings,
        removedWorkspaces: skillRuntime.removedWorkspaces
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("skill_runtime_init_failed", { message });
      skillRuntime = {
        homeDir: app.getPath("userData"),
        codexHomeDir: process.env.CODEX_HOME || resolveCodexHomeDir(app.getPath("userData")),
        appSkillsDir: "",
        bundledSkillsDir: "",
        userSkillsDir: "",
        workspaceDir: process.cwd(),
        availableSkills: [],
        updatedSettings: [],
        removedWorkspaces: []
      };
    }

    const scheduler = new SchedulerService({
      logger: createLogger("scheduler"),
      userDataDir: app.getPath("userData"),
      onNotification: (event) => {
        broadcastSchedulerNotification(event);
        if (BrowserWindow.getFocusedWindow() === null) {
          notificationService.notify("lilto - スケジュール通知", event.message);
          notificationService.incrementBadge();
        }
      }
    });
    void scheduler.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SchedulerUnavailableError) {
        logger.info("scheduler_unavailable", { message });
        return;
      }
      logger.error("scheduler_start_failed", { message });
    });

    schedulerBridge = new SchedulerBridgeServer({
      logger: createLogger("scheduler-bridge"),
      scheduler
    });
    await schedulerBridge.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("scheduler_bridge_start_failed", { message });
    });

    authService = new ClaudeAuthService({
      logger: createLogger("auth"),
      codexHome: skillRuntime.codexHomeDir
    });
    const modelCatalogService = new ModelCatalogService({
      logger: createLogger("models"),
      codexHomeDir: skillRuntime.codexHomeDir
    });
    const windowsSandboxSetupService = new WindowsSandboxSetupService({
      logger: createLogger("windows-sandbox-setup"),
      codexHomeDir: skillRuntime.codexHomeDir,
      workspaceDir: skillRuntime.workspaceDir
    });

    const agentRuntime = new AgentRuntime({
      logger: createLogger("agent"),
      authService,
      workspaceDir: skillRuntime.workspaceDir,
      codexHomeDir: skillRuntime.codexHomeDir,
      homeDir: skillRuntime.homeDir,
      schedulerBridge,
      availableSkills: skillRuntime.availableSkills
    });

    registerAgentIpcHandlers({
      agentRuntime,
      authService,
      providerSettingsService,
      notificationService,
      modelCatalogService,
      windowsSandboxSetupService,
      bundledSkillsDir: skillRuntime.bundledSkillsDir,
      userSkillsDir: skillRuntime.userSkillsDir,
      homeDir: skillRuntime.homeDir,
      codexHomeDir: skillRuntime.codexHomeDir,
      onSettingsSaved: (settings) => {
        registerAppShortcut(settings.chatSettings.globalShortcut, () => mainWindow);
      }
    });
    createWindow();
    notificationService.setupTray(() => mainWindow);
    heartbeat.start();

    // グローバルショートカットを設定
    const initialShortcut = providerSettingsService.getState().chatSettings.globalShortcut;
    registerAppShortcut(initialShortcut, () => mainWindow);

    app.on("activate", () => {
      if (!mainWindow) {
        createWindow();
        return;
      }
      showAndFocusMainWindow();
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  unregisterAppShortcut();
  heartbeat.stop();
  schedulerBridge?.stop();
  schedulerBridge = null;
  authService?.dispose();
  authService = null;
});

app.on("window-all-closed", () => {
  // Main process resident behavior: ignore default quit flow.
});
