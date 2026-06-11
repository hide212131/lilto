import { ipcMain } from "electron";

import type { AgentRuntime } from "../agent-sdk";
import type { PluginService, PluginCatalogSourceKind } from "../plugin-service";
import { checkSkillUpdates, installSkillFromSource, installSkillFromUrl, listSkillsWithSource, uninstallUserSkill } from "../skill-runtime";

export function registerSkillsAndPluginIpcHandlers({
  agentRuntime,
  bundledSkillsDir,
  userSkillsDir,
  workspaceDir,
  homeDir,
  codexHomeDir,
  pluginService
}: {
  agentRuntime: AgentRuntime;
  bundledSkillsDir: string;
  userSkillsDir: string;
  workspaceDir: string;
  homeDir: string;
  codexHomeDir: string;
  pluginService: PluginService;
}): void {
  const refreshAgentSkills = () => {
    const latestSkills = listSkillsWithSource({ bundledSkillsDir, userSkillsDir });
    agentRuntime.refreshSkills(latestSkills);
  };

  const refreshAgentPlugins = () => {
    agentRuntime.refreshPlugins();
  };

  ipcMain.handle("skills:list", () => {
    try {
      return {
        ok: true as const,
        skills: listSkillsWithSource({ bundledSkillsDir, userSkillsDir })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle("skills:install", async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown> | null;
    if (!p) return { ok: false, error: "payload が必須です" };

    if (typeof p.source === "string") {
      const result = await installSkillFromSource({ source: p.source, projectRoot: workspaceDir, userSkillsDir, homeDir, codexHomeDir });
      if (result.ok) {
        refreshAgentSkills();
      }
      return result;
    }

    if (typeof p.url === "string") {
      const result = await installSkillFromUrl({ url: p.url, userSkillsDir });
      if (result.ok) {
        refreshAgentSkills();
      }
      return result;
    }

    return { ok: false, error: "source または url は必須です" };
  });

  ipcMain.handle("skills:uninstall", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || typeof (payload as { filePath?: unknown }).filePath !== "string") {
      return { ok: false, error: "filePath は必須です" };
    }
    const result = uninstallUserSkill({ skillFilePath: (payload as { filePath: string }).filePath, userSkillsDir });
    if (result.ok) {
      refreshAgentSkills();
    }
    return result;
  });

  ipcMain.handle("skills:checkUpdates", async () => {
    return checkSkillUpdates({ userSkillsDir, bundledSkillsDir });
  });

  ipcMain.handle("plugins:list", async (_event, payload: unknown) => {
    const forceRemoteSync = Boolean(
      payload &&
      typeof payload === "object" &&
      typeof (payload as { forceRemoteSync?: unknown }).forceRemoteSync === "boolean" &&
      (payload as { forceRemoteSync: boolean }).forceRemoteSync
    );
    return await pluginService.listPlugins({ forceRemoteSync });
  });

  ipcMain.handle("plugins:read", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "payload が必須です" }
      };
    }

    const marketplacePath = typeof (payload as { marketplacePath?: unknown }).marketplacePath === "string"
      ? (payload as { marketplacePath: string }).marketplacePath
      : null;
    const pluginName = typeof (payload as { pluginName?: unknown }).pluginName === "string"
      ? (payload as { pluginName: string }).pluginName
      : null;

    if (!marketplacePath || !pluginName) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_REQUEST",
          message: "marketplacePath, pluginName は必須です"
        }
      };
    }

    return await pluginService.readPlugin({ marketplacePath, pluginName });
  });

  ipcMain.handle("plugins:install", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "payload が必須です" }
      };
    }

    const marketplacePath = typeof (payload as { marketplacePath?: unknown }).marketplacePath === "string"
      ? (payload as { marketplacePath: string }).marketplacePath
      : null;
    const pluginName = typeof (payload as { pluginName?: unknown }).pluginName === "string"
      ? (payload as { pluginName: string }).pluginName
      : null;
    const sourceKind = (payload as { sourceKind?: unknown }).sourceKind === "bundled"
      ? "bundled"
      : (payload as { sourceKind?: unknown }).sourceKind === "official-curated"
        ? "official-curated"
        : null;

    if (!marketplacePath || !pluginName || !sourceKind) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_REQUEST",
          message: "marketplacePath, pluginName, sourceKind は必須です"
        }
      };
    }

    const result = await pluginService.installPlugin({
      marketplacePath,
      pluginName,
      sourceKind: sourceKind as PluginCatalogSourceKind
    });
    if (result.ok) {
      refreshAgentPlugins();
    }
    return result;
  });

  ipcMain.handle("plugins:uninstall", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "payload が必須です" }
      };
    }

    const pluginId = typeof (payload as { pluginId?: unknown }).pluginId === "string"
      ? (payload as { pluginId: string }).pluginId
      : null;
    const sourceKind = (payload as { sourceKind?: unknown }).sourceKind === "bundled"
      ? "bundled"
      : (payload as { sourceKind?: unknown }).sourceKind === "official-curated"
        ? "official-curated"
        : undefined;

    if (!pluginId) {
      return {
        ok: false as const,
        error: { code: "INVALID_REQUEST", message: "pluginId は必須です" }
      };
    }

    const result = await pluginService.uninstallPlugin({
      pluginId,
      sourceKind: sourceKind as PluginCatalogSourceKind | undefined
    });
    if (result.ok) {
      refreshAgentPlugins();
    }
    return result;
  });
}