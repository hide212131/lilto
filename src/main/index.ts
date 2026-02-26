import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow } from "electron";

import { AgentRuntime } from "./agent-sdk";
import { ClaudeAuthService } from "./auth-service";
import { readConfig } from "./config";
import { HeartbeatScheduler } from "./heartbeat";
import { registerAgentIpcHandlers } from "./ipc";
import { createLogger } from "./logger";
import { ProviderSettingsService } from "./provider-settings";
import { setupSkillRuntime } from "./skill-runtime";
import { createCliCompatibilityMap } from "./command-compat";

const config = readConfig();
const logger = createLogger("main");

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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
}

void app.whenReady().then(() => {
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

  heartbeat.registerJob({
    id: "liltobook-heartbeat",
    enabled: skillRuntime.availableSkills.some((skill) => skill.name === "liltobook"),
    handler: async () => {
      const heartbeatPath = path.join(skillRuntime.bundledSkillsDir, "liltobook", "HEARTBEAT.md");
      if (!fs.existsSync(heartbeatPath)) {
        logger.info("liltobook_heartbeat_skipped", { reason: "heartbeat_doc_missing", heartbeatPath });
        return;
      }

      const heartbeatMarkdown = fs.readFileSync(heartbeatPath, "utf8");
      const result = await agentRuntime.runLiltobookHeartbeat({
        heartbeatMarkdown,
        providerSettings: providerSettingsService.getState()
      });
      logger.info("liltobook_heartbeat_result", result);
    }
  });

  registerAgentIpcHandlers({ agentRuntime, authService, providerSettingsService });
  createWindow();
  heartbeat.start();

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
  heartbeat.stop();
  authService.dispose();
});

app.on("window-all-closed", () => {
  // Main process resident behavior: ignore default quit flow.
});
