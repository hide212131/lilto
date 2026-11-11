import path from "node:path";
import { ConversationHistoryService } from "./conversation-history";
import { registerAgentConversationIpcHandlers } from "./ipc/agent-conversation";
import { registerAuthAndProviderIpcHandlers } from "./ipc/auth-provider";
import { registerBrowserIpcHandlers } from "./ipc/browser";
import { registerSchedulerSystemIpcHandlers } from "./ipc/scheduler-system";
import { registerSkillsAndPluginIpcHandlers } from "./ipc/skills-plugins";
import type { RegisterAgentIpcHandlersOptions } from "./ipc/types";

export function registerAgentIpcHandlers({
  agentRuntime,
  authService,
  providerSettingsService,
  bundledSkillsDir,
  userSkillsDir,
  workspaceDir,
  homeDir,
  codexHomeDir,
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
  registerAgentConversationIpcHandlers({
    agentRuntime,
    providerSettingsService,
    notificationService,
    pluginService,
    conversationHistory,
    scheduler
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
