import path from "node:path";
import { app, BrowserWindow } from "electron";

import { AgentRuntime } from "./agent-sdk";
import { ClaudeAuthService } from "./auth-service";
import { readConfig } from "./config";
import { registerAppShortcut, unregisterAppShortcut } from "./global-shortcut";
import { HeartbeatScheduler } from "./heartbeat";
import { registerAgentIpcHandlers } from "./ipc";
import { createLogger } from "./logger";
import { NotificationService } from "./notifications";
import { ProviderSettingsService } from "./provider-settings";
import { setupSkillRuntime } from "./skill-runtime";
import { createCliCompatibilityMap } from "./command-compat";
import { resolveAppIcon, resolveWindowIcon } from "./icon-assets";

const config = readConfig();
const logger = createLogger("main");

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

const notificationService = new NotificationService();

const authService = new ClaudeAuthService({ logger: createLogger("auth") });
const providerSettingsService = new ProviderSettingsService({ logger: createLogger("providers") });

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

  // ウインドウがフォーカスされたら未読バッジをクリアする
  mainWindow.on("focus", () => {
    notificationService.clearBadge();
  });
}

void app.whenReady().then(() => {
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
      workspaceTtlHours: Number(process.env.LILTO_PI_WORKSPACE_TTL_HOURS || 24 * 7)
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
      appSkillsDir: "",
      bundledSkillsDir: "",
      userSkillsDir: "",
      workspaceDir: process.cwd(),
      availableSkills: [],
      updatedSettings: [],
      removedWorkspaces: []
    };
  }

  const agentRuntime = new AgentRuntime({
    logger: createLogger("agent"),
    authService,
    workspaceDir: skillRuntime.workspaceDir,
    availableSkills: skillRuntime.availableSkills
  });

  registerAgentIpcHandlers({
    agentRuntime,
    authService,
    providerSettingsService,
    notificationService,
    bundledSkillsDir: skillRuntime.bundledSkillsDir,
    userSkillsDir: skillRuntime.userSkillsDir,
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
    mainWindow.show();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  unregisterAppShortcut();
  heartbeat.stop();
  authService.dispose();
});

app.on("window-all-closed", () => {
  // Main process resident behavior: ignore default quit flow.
});
