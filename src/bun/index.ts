import path from "node:path";
import os from "node:os";
import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { randomUUID } from "node:crypto";

import { AgentRuntime } from "../main/agent-sdk";
import { ClaudeAuthService } from "../main/auth-service";
import { readConfig } from "../main/config";
import { HeartbeatScheduler } from "../main/heartbeat";
import { createLogger } from "../main/logger";
import { ProviderSettingsService } from "../main/provider-settings";
import { setupSkillRuntime } from "../main/skill-runtime";
import { createCliCompatibilityMap } from "../main/command-compat";
import { validatePrompt } from "../main/ipc-contract";
import type { AgentLoopEvent } from "../shared/agent-loop";
import type { LiltoRPC } from "../shared/rpc-schema";

const config = readConfig();
const logger = createLogger("main");

const authService = new ClaudeAuthService({
  logger: createLogger("auth"),
  openExternal: async (url: string) => {
    Utils.openExternal(url);
  }
});

const providerSettingsService = new ProviderSettingsService({
  logger: createLogger("providers")
});

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

// Resolve app data directory (falls back when version.json is unavailable in dev)
function resolveAppDataDir(): string {
  try {
    return Utils.paths.userData;
  } catch {
    return path.join(os.homedir(), ".config", "lilt-o");
  }
}

// Setup skill runtime
let skillRuntime;
try {
  skillRuntime = setupSkillRuntime({
    appDataDir: resolveAppDataDir(),
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

logger.info("cli_compatibility_resolved", {
  platform: process.platform,
  commands: createCliCompatibilityMap()
});

// Broadcast helpers — forward events to the webview via RPC messages
function broadcastLoopEvent(event: AgentLoopEvent): void {
  const rpc = mainWindow?.webview.rpc;
  if (rpc) {
    rpc.send.agentLoopEvent(event);
  }
}

function broadcastAuthState(): void {
  const rpc = mainWindow?.webview.rpc;
  if (rpc) {
    rpc.send.authStateChanged(authService.getState());
  }
}

// Subscribe to auth state changes (registered before window creation; fires after)
authService.subscribe(() => {
  broadcastAuthState();
});

// Define bun-side RPC handlers
const rpc = BrowserView.defineRPC<LiltoRPC>({
  maxRequestTime: 60000,
  handlers: {
    requests: {
      submitPrompt: async ({ text }) => {
        const validation = validatePrompt({ text });
        if (!validation.ok) {
          return { ok: false, error: { code: validation.code, message: validation.message } } as const;
        }

        const requestId = randomUUID();
        broadcastLoopEvent({ type: "run_start", requestId });

        try {
          const providerSettings = providerSettingsService.getState();
          const result = await agentRuntime.submitPrompt(text, providerSettings, {
            requestId,
            onLoopEvent: (event) => {
              broadcastLoopEvent(event);
            }
          });

          if (!result.ok) {
            broadcastLoopEvent({
              type: "run_end",
              requestId,
              status: "failed",
              errorMessage: `${result.error.code}: ${result.error.message}`
            });
            return result;
          }

          broadcastLoopEvent({ type: "run_end", requestId, status: "completed" });
          return { ok: true, request: { text }, response: { text: result.text } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          broadcastLoopEvent({ type: "run_end", requestId, status: "failed", errorMessage: message });
          throw error;
        }
      },

      getAuthState: () => authService.getState(),

      startClaudeOauth: async () => {
        const oauthProvider = providerSettingsService.getState().oauthProvider;
        const state = await authService.startOAuth(oauthProvider);
        return { ok: state.phase === "authenticated", state };
      },

      submitAuthCode: ({ code }) => {
        try {
          const state = authService.submitAuthorizationCode(code);
          return { ok: true, state };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, error: { code: "AUTH_CODE_REJECTED", message } };
        }
      },

      getProviderSettings: () => providerSettingsService.getState(),

      saveProviderSettings: (params) => providerSettingsService.save(params)
    },
    messages: {}
  }
});

// Create main window
let mainWindow: BrowserWindow<typeof rpc> | null = null;

mainWindow = new BrowserWindow({
  title: config.appName,
  url: "views://mainview/index.html",
  rpc,
  frame: {
    width: 980,
    height: 720,
    x: 0,
    y: 0
  }
});

heartbeat.start();

// Cleanup on app quit
process.on("exit", () => {
  heartbeat.stop();
  authService.dispose();
});
