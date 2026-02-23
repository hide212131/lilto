import path from "node:path";
import { app, BrowserWindow } from "electron";

import { PiAgentBridge } from "./agent-sdk";
import { readConfig } from "./config";
import { HeartbeatScheduler } from "./heartbeat";
import { registerAgentIpcHandlers } from "./ipc";
import { createLogger } from "./logger";

const config = readConfig();
const logger = createLogger("main");

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

const agentBridge = new PiAgentBridge({ logger: createLogger("agent") });

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

  void mainWindow.loadFile(path.join(process.cwd(), "src", "renderer", "index.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

void app.whenReady().then(() => {
  registerAgentIpcHandlers({ agentBridge });
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
});

app.on("window-all-closed", () => {
  // Main process resident behavior: ignore default quit flow.
});
