import path from "node:path";
import { app, BrowserWindow } from "electron";

import { AgentRuntime } from "./agent-sdk";
import { ClaudeAuthService } from "./auth-service";
import { readConfig } from "./config";
import { registerAppShortcut, unregisterAppShortcut } from "./global-shortcut";
import { HeartbeatAssistantService } from "./heartbeat-assistant";
import { HeartbeatScheduler } from "./heartbeat";
import { SCHEDULER_NOTIFICATION_CHANNEL } from "./ipc-contract";
import { registerAgentIpcHandlers } from "./ipc";
import { createLogger } from "./logger";
import { NotificationService } from "./notifications";
import { ProviderSettingsService } from "./provider-settings";
import { ModelCatalogService } from "./model-catalog";
import { CodexPluginService } from "./plugin-service";
import { SchedulerService } from "./scheduler";
import { SchedulerUnavailableError } from "./scheduler";
import { SchedulerBridgeServer } from "./scheduler-bridge";
import { resolveCodexHomeDir, setupSkillRuntime } from "./skill-runtime";
import { WindowsSandboxSetupService } from "./windows-sandbox-setup";
import { createCliCompatibilityMap } from "./command-compat";
import { resolvePreloadPath, resolveRendererIndexPath } from "./app-paths";
import { resolveAppIcon, resolveWindowIcon } from "./icon-assets";
import { SpeechTranscriptionService } from "./speech-transcription";
import { configureAppUserDataPath } from "./user-data-path";
import type { SchedulerNotificationEvent } from "../shared/scheduler";

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

const notificationService = new NotificationService();

let authService: ClaudeAuthService | null = null;
let providerSettingsService: ProviderSettingsService | null = null;

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
        app.dock.setIcon(dockIcon);
      }
    }

    logger.info("cli_compatibility_resolved", {
      platform: process.platform,
      commands: createCliCompatibilityMap()
    });

    providerSettingsService = new ProviderSettingsService({
      logger: createLogger("providers"),
      storagePath: path.join(app.getPath("userData"), "provider-settings.json")
    });
    const initializedProviderSettingsService = providerSettingsService;

    let skillRuntime;
    try {
      skillRuntime = setupSkillRuntime({
        appDataDir: app.getPath("userData"),
        projectName: path.basename(defaultWorkspaceDir),
        projectRoot: defaultWorkspaceDir,
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
        appDataDir: app.getPath("userData"),
        codexHomeDir: process.env.CODEX_HOME || resolveCodexHomeDir(app.getPath("userData")),
        appSkillsDir: "",
        bundledSkillsDir: "",
        userSkillsDir: "",
        workspaceDir: defaultWorkspaceDir,
        availableSkills: [],
        updatedSettings: [],
        removedWorkspaces: []
      };
    }

    const scheduler = new SchedulerService({
      logger: createLogger("scheduler"),
      userDataDir: app.getPath("userData"),
      onNotification: (event) => {
        const shouldDeferVisibleNotification = Boolean(
          event.notificationDecisionCriteria && event.followUpInstruction
        );
        if (heartbeatAssistant) {
          void heartbeatAssistant.handleSchedulerNotification(event).then((handled) => {
            if (handled) {
              return;
            }
            broadcastSchedulerNotification(event);
            if (!shouldDeferVisibleNotification && BrowserWindow.getFocusedWindow() === null) {
              notificationService.notify("lilto - スケジュール通知", event.message);
              notificationService.incrementBadge();
            }
          });
          return;
        }
        broadcastSchedulerNotification(event);
        if (!shouldDeferVisibleNotification && BrowserWindow.getFocusedWindow() === null) {
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
      authPath: path.join(app.getPath("userData"), "auth-state.json"),
      codexHome: skillRuntime.codexHomeDir,
      fallbackCodexHome: skillRuntime.codexHomeDir
    });
    const modelCatalogService = new ModelCatalogService({
      logger: createLogger("models"),
      codexHomeDir: skillRuntime.codexHomeDir
    });
    const pluginService = new CodexPluginService({
      logger: createLogger("plugins"),
      workspaceDir: skillRuntime.workspaceDir,
      homeDir: skillRuntime.appDataDir,
      codexHomeDir: skillRuntime.codexHomeDir
    });
    const windowsSandboxSetupService = new WindowsSandboxSetupService({
      logger: createLogger("windows-sandbox-setup"),
      codexHomeDir: skillRuntime.codexHomeDir,
      workspaceDir: skillRuntime.workspaceDir
    });
    const speechTranscriptionService = new SpeechTranscriptionService();

    const agentRuntime = new AgentRuntime({
      logger: createLogger("agent"),
      authService,
      workspaceDir: skillRuntime.workspaceDir,
      codexHomeDir: skillRuntime.codexHomeDir,
      schedulerBridge,
      availableSkills: skillRuntime.availableSkills
    });

    heartbeatAssistant = new HeartbeatAssistantService({
      logger: createLogger("heartbeat-assistant"),
      scheduler,
      agentRuntime,
      notificationService,
      userDataDir: app.getPath("userData"),
      getProviderSettings: () => {
        return initializedProviderSettingsService.getState();
      },
      broadcastNotification: broadcastSchedulerNotification,
      getFocusedWindow: () => BrowserWindow.getFocusedWindow()
    });
    void heartbeatAssistant.syncManagedSchedule(initializedProviderSettingsService.getState());

    registerAgentIpcHandlers({
      agentRuntime,
      authService,
      providerSettingsService: initializedProviderSettingsService,
      notificationService,
      scheduler,
      heartbeatAssistant,
      pluginService,
      modelCatalogService,
      speechTranscriptionService,
      windowsSandboxSetupService,
      bundledSkillsDir: skillRuntime.bundledSkillsDir,
      userSkillsDir: skillRuntime.userSkillsDir,
      workspaceDir: skillRuntime.workspaceDir,
      homeDir: skillRuntime.appDataDir,
      codexHomeDir: skillRuntime.codexHomeDir,
      onSettingsSaved: (settings) => {
        registerAppShortcut(settings.chatSettings.globalShortcut, () => mainWindow);
        void heartbeatAssistant?.syncManagedSchedule(settings);
      }
    });
    createWindow();
    notificationService.setupTray(() => mainWindow);
    heartbeat.start();

    // グローバルショートカットを設定
    const initialShortcut = initializedProviderSettingsService.getState().chatSettings.globalShortcut;
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
  heartbeatAssistant = null;
  authService?.dispose();
  authService = null;
});

app.on("window-all-closed", () => {
  // Main process resident behavior: ignore default quit flow.
});
