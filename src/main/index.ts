import { app, BrowserWindow, Menu } from "electron";

import { readConfig } from "./config";
import { registerAppShortcut, unregisterAppShortcut } from "./global-shortcut";
import { HeartbeatAssistantService } from "./heartbeat-assistant";
import { HeartbeatScheduler } from "./heartbeat";
import { SCHEDULER_NOTIFICATION_CHANNEL } from "./ipc-contract";
import { registerAgentIpcHandlers } from "./ipc";
import { createLogger } from "./logger";
import { initializeMainRuntime, type InitializedMainRuntime } from "./main-runtime";
import { NotificationService } from "./notifications";
import { SchedulerBridgeServer } from "./scheduler-bridge";
import { createCliCompatibilityMap } from "./command-compat";
import { configureAppUserDataPath, resolvePreloadPath, resolveRendererIndexPath } from "./app-paths";
import { resolveAppIcon, resolveWindowIcon } from "./icon-assets";
import type { SchedulerNotificationEvent } from "../shared/scheduler";
import { APP_UPDATE_OPEN_CHANNEL, APP_UPDATE_STATE_CHANNEL } from "../shared/app-update";
import { AppUpdateService } from "./app-update-service";
import { registerAppUpdateIpcHandlers } from "./ipc/app-update";

const config = readConfig();
configureAppUserDataPath(app);
const logger = createLogger("main");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (process.platform === "win32") {
  app.setAppUserModelId("dev.hide.lilto");
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let schedulerBridge: SchedulerBridgeServer | null = null;
let heartbeatAssistant: HeartbeatAssistantService | null = null;
let appUpdateService: AppUpdateService | null = null;

const notificationService = new NotificationService();

let authService: InitializedMainRuntime["authService"] | null = null;
let providerSettingsService: InitializedMainRuntime["providerSettingsService"] | null = null;

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
  const appRoot = app.getAppPath();
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: resolvePreloadPath({ appRoot }),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: config.appName
  });

  void mainWindow.loadFile(resolveRendererIndexPath({ appRoot }));

  mainWindow.webContents.on("did-finish-load", () => {
    if (process.platform === "win32" && app.isPackaged) void appUpdateService?.check("startup");
  });

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
    process.env.LILTO_APP_ROOT = app.getAppPath();
    process.env.LILTO_RESOURCES_PATH = process.resourcesPath;
    const defaultWorkspaceDir = app.isPackaged ? app.getPath("userData") : process.cwd();

    if (process.platform === "darwin") {
      const dockIcon = resolveAppIcon(512);
      if (!dockIcon.isEmpty()) {
        app.dock?.setIcon(dockIcon);
      }
    }

    logger.info("cli_compatibility_resolved", {
      platform: process.platform,
      commands: createCliCompatibilityMap()
    });

    const runtime = await initializeMainRuntime({
      defaultWorkspaceDir,
      logger,
      notificationService,
      heartbeat,
      userDataDir: app.getPath("userData"),
      broadcastSchedulerNotification,
      mainWindow: () => mainWindow
    });
    authService = runtime.authService;
    providerSettingsService = runtime.providerSettingsService;
    schedulerBridge = runtime.schedulerBridge;
    heartbeatAssistant = runtime.heartbeatAssistant;
    appUpdateService = new AppUpdateService({
      logger: createLogger("app-update"),
      currentVersion: app.getVersion(),
      supported: process.platform === "win32" && app.isPackaged,
      prepareForUpdate: async () => {
        if (runtime.agentRuntime.isBusy || runtime.scheduler.isBusy || runtime.speechTranscriptionService.isBusy) return false;
        await runtime.scheduler.stop();
        isQuitting = true;
        return true;
      },
      resumeAfterFailedPreparation: async () => {
        isQuitting = false;
        await runtime.scheduler.resume().catch((error: unknown) => {
          logger.error("scheduler_restart_after_update_failure", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      },
      publish: (state) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(APP_UPDATE_STATE_CHANNEL, state);
      }
    });
    const initializedProviderSettingsService = runtime.providerSettingsService;

    registerAgentIpcHandlers({
      agentRuntime: runtime.agentRuntime,
      authService,
      providerSettingsService: initializedProviderSettingsService,
      notificationService,
      scheduler: runtime.scheduler,
      heartbeatAssistant,
      pluginService: runtime.pluginService,
      modelCatalogService: runtime.modelCatalogService,
      speechTranscriptionService: runtime.speechTranscriptionService,
      windowsSandboxSetupService: runtime.windowsSandboxSetupService,
      bundledSkillsDir: runtime.skillRuntime.bundledSkillsDir,
      userSkillsDir: runtime.skillRuntime.userSkillsDir,
      workspaceDir: runtime.skillRuntime.workspaceDir,
      homeDir: runtime.skillRuntime.appDataDir,
      codexHomeDir: runtime.skillRuntime.codexHomeDir,
      onSettingsSaved: (settings) => {
        registerAppShortcut(settings.chatSettings.globalShortcut, () => mainWindow);
        void heartbeatAssistant?.syncManagedSchedule(settings);
      }
    });
    createWindow();
    const openUpdate = () => {
      showAndFocusMainWindow();
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(APP_UPDATE_OPEN_CHANNEL);
      void appUpdateService?.check("manual");
    };
    notificationService.setupTray(() => mainWindow, openUpdate);
    if (process.platform === "win32") {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: "ファイル", submenu: [{ role: "quit", label: "終了" }] },
        { role: "editMenu" },
        { label: "表示", submenu: [{ role: "reload", label: "再読み込み" }, { role: "toggleDevTools", label: "開発者ツール" }] },
        { label: "ヘルプ", submenu: [{ label: "更新を確認…", click: openUpdate }] }
      ]));
    }

    registerAppUpdateIpcHandlers(appUpdateService);

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
  heartbeatAssistant = null;
  authService?.dispose();
  authService = null;
});

app.on("window-all-closed", () => {
  // Main process resident behavior: ignore default quit flow.
});
