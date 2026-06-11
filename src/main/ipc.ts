import path from "node:path";
import { ConversationHistoryService } from "./conversation-history";
import { registerAgentConversationIpcHandlers } from "./ipc/agent-conversation";
import { registerAuthAndProviderIpcHandlers } from "./ipc/auth-provider";
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
  onSettingsSaved
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
    conversationHistory
  });

  registerAuthAndProviderIpcHandlers({
    agentRuntime,
    authService,
    providerSettingsService,
    heartbeatAssistant,
    modelCatalogService,
    onSettingsSaved
  });

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
    pluginService
  });
}
