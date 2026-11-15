import path from "node:path";
import { ConversationHistoryService } from "./conversation-history";
import { registerAgentConversationIpcHandlers } from "./ipc/agent-conversation";
import { registerAuthAndProviderIpcHandlers } from "./ipc/auth-provider";
import { registerBrowserIpcHandlers } from "./ipc/browser";
import { registerSchedulerSystemIpcHandlers } from "./ipc/scheduler-system";
import { registerSkillsAndPluginIpcHandlers } from "./ipc/skills-plugins";
import type { RegisterAgentIpcHandlersOptions } from "./ipc/types";
import { buildSessionPinNamespace, SessionPinStore } from "./session-pin-store";

export function registerAgentIpcHandlers({
  agentRuntime,
  authService,
  providerSettingsService,
  bundledSkillsDir,
  userSkillsDir,
  workspaceDir,
  homeDir,
  codexHomeDir,
  userDataDir,
  notificationService,
  scheduler,
  heartbeatAssistant,
  pluginService,
  modelCatalogService,
  speechTranscriptionService,
  windowsSandboxSetupService,
  onSettingsSaved,
  browserSettingsFlow,
  browserController,
  getMainWindow,
  applySkillPolicy
}: RegisterAgentIpcHandlersOptions): void {
  const agentsFilePath = path.join(workspaceDir, "AGENTS.md");
  const conversationHistory = new ConversationHistoryService({
    workspaceDir,
    homeDir,
    codexHomeDir
  });
  const sessionPinStore = new SessionPinStore({ filePath: path.join(userDataDir, "session-pins.json") });
  const sessionPinNamespace = buildSessionPinNamespace(codexHomeDir, workspaceDir);
  registerAgentConversationIpcHandlers({
    agentRuntime,
    providerSettingsService,
    notificationService,
    pluginService,
    conversationHistory,
    scheduler,
    sessionPinStore,
    sessionPinNamespace
  });

  registerAuthAndProviderIpcHandlers({
    agentRuntime,
    authService,
    providerSettingsService,
    heartbeatAssistant,
    modelCatalogService,
    onSettingsSaved,
    browserSettingsFlow
  });

  if (browserController && getMainWindow) registerBrowserIpcHandlers(browserController, getMainWindow);

  registerSchedulerSystemIpcHandlers({
    scheduler,
    notificationService,
    speechTranscriptionService,
    windowsSandboxSetupService,
    agentsFilePath
  });

  registerSkillsAndPluginIpcHandlers({
    agentRuntime,
    bundledSkillsDir,
    userSkillsDir,
    workspaceDir,
    homeDir,
    codexHomeDir,
    pluginService,
    applySkillPolicy
  });
}
