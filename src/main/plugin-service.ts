import fs from "node:fs";
import path from "node:path";
import { CodexAppServerClient } from "./codex-app-server-client";
import { createLogger, type Logger } from "./logger";
import {
  PLUGIN_CACHE_DIR,
  formatPluginInstallError,
  hasInstalledPluginCache,
  inferPluginSourceKind,
  mapPluginApps,
  normalizeAuthPolicy,
  normalizeInstallPolicy,
  readCuratedPluginsSha,
  readEnabledPluginIds,
  readPluginInstallMetadata,
  removePluginInstallMetadataRecord,
  resolvePluginCatalogSources,
  type PluginInstallMetadataRecord,
  type RawPluginListResponse,
  type RawPluginSummary,
  upsertPluginInstallMetadataRecord
} from "./plugin-service-helpers";

const REPO_MARKETPLACE_RELATIVE_PATH = path.join(".agents", "plugins", "marketplace.json");

export { resolvePluginCatalogSources };

export type PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";
export type PluginAuthPolicy = "ON_INSTALL" | "ON_USE";
export type PluginCatalogSourceKind = "official-curated" | "bundled";

export type PluginCatalogInfo = {
  kind: PluginCatalogSourceKind;
  name: string;
  displayName: string;
  marketplacePath: string;
  pluginCount: number;
};

export type PluginInfo = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  marketplaceName: string;
  marketplacePath: string;
  sourceKind: PluginCatalogSourceKind;
  sourcePath: string | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: PluginInstallPolicy;
  authPolicy: PluginAuthPolicy;
  category: string | null;
  capabilities: string[];
  featured: boolean;
  installedVersion: string | null;
  installedAt: number | null;
  userInstalled: boolean;
};

export type PluginAppInfo = {
  id: string;
  name: string;
  description: string | null;
  installUrl: string | null;
  needsAuth: boolean;
};

export type PluginMarketplaceLoadError = {
  marketplacePath: string;
  message: string;
};

export type PluginListState = {
  catalogs: PluginCatalogInfo[];
  marketplacePlugins: PluginInfo[];
  installedPlugins: PluginInfo[];
  marketplaceLoadErrors: PluginMarketplaceLoadError[];
  remoteSyncError: string | null;
};

export type PluginActionResult =
  | { ok: true; state: PluginListState; message?: string }
  | { ok: false; error: { code: string; message: string }; state?: PluginListState };

export type PluginReadResult =
  | { ok: true; plugin: PluginInfo; apps: PluginAppInfo[] }
  | { ok: false; error: { code: string; message: string } };

export type PluginService = {
  listPlugins(options?: { forceRemoteSync?: boolean }): Promise<PluginActionResult>;
  readPlugin(options: { marketplacePath: string; pluginName: string }): Promise<PluginReadResult>;
  installPlugin(options: {
    marketplacePath: string;
    pluginName: string;
    sourceKind: PluginCatalogSourceKind;
  }): Promise<PluginActionResult>;
  uninstallPlugin(options: {
    pluginId: string;
    sourceKind?: PluginCatalogSourceKind;
  }): Promise<PluginActionResult>;
};

type RawPluginReadResponse = {
  plugin?: {
    marketplaceName: string;
    marketplacePath: string;
    summary: RawPluginSummary;
    description?: string | null;
    apps?: Array<{
      id?: string;
      name?: string;
      description?: string | null;
      installUrl?: string | null;
      needsAuth?: boolean;
    }>;
  };
};

type RawPluginInstallResponse = {
  authPolicy?: PluginAuthPolicy;
  appsNeedingAuth?: Array<{
    id?: string;
    name?: string;
    description?: string | null;
    installUrl?: string | null;
    needsAuth?: boolean;
  }>;
};

function mapPluginState(options: {
  response: RawPluginListResponse;
  bundledMarketplacePath: string | null;
  metadataRecords: PluginInstallMetadataRecord[];
  localErrors: PluginMarketplaceLoadError[];
  codexHomeDir: string;
}): PluginListState {
  const marketplaces = Array.isArray(options.response.marketplaces) ? options.response.marketplaces : [];
  const featuredIds = new Set(Array.isArray(options.response.featuredPluginIds) ? options.response.featuredPluginIds : []);
  const metadataByPluginId = new Map(options.metadataRecords.map((record) => [record.pluginId, record]));
  const enabledPluginIds = readEnabledPluginIds(options.codexHomeDir);

  const catalogs: PluginCatalogInfo[] = marketplaces.map((marketplace) => ({
    kind: inferPluginSourceKind(marketplace.path, options.bundledMarketplacePath),
    name: marketplace.name,
    displayName: marketplace.interface?.displayName?.trim() || marketplace.name,
    marketplacePath: marketplace.path,
    pluginCount: Array.isArray(marketplace.plugins) ? marketplace.plugins.length : 0
  }));

  const marketplacePlugins = marketplaces.flatMap((marketplace) => {
    const sourceKind = inferPluginSourceKind(marketplace.path, options.bundledMarketplacePath);
    return marketplace.plugins.map((plugin) => {
      const metadata = metadataByPluginId.get(plugin.id) ?? null;
      const installedFromCache = hasInstalledPluginCache(options.codexHomeDir, {
        marketplaceName: marketplace.name,
        name: plugin.name
      });
      const installed = Boolean(plugin.installed) || installedFromCache;
      const enabled = Boolean(plugin.enabled) || enabledPluginIds.has(plugin.id) || (metadata !== null && installedFromCache);
      return {
        id: plugin.id,
        name: plugin.name,
        displayName: plugin.interface?.displayName?.trim() || plugin.name,
        description: plugin.interface?.shortDescription ?? null,
        marketplaceName: marketplace.name,
        marketplacePath: marketplace.path,
        sourceKind,
        sourcePath: plugin.source?.type === "local" && typeof plugin.source.path === "string"
          ? plugin.source.path
          : null,
        installed,
        enabled,
        installPolicy: normalizeInstallPolicy(plugin),
        authPolicy: normalizeAuthPolicy(plugin),
        category: plugin.interface?.category ?? null,
        capabilities: Array.isArray(plugin.interface?.capabilities) ? plugin.interface.capabilities : [],
        featured: featuredIds.has(plugin.id),
        installedVersion: metadata?.installedVersion ?? null,
        installedAt: metadata?.installedAt ?? null,
        userInstalled: metadata !== null
      } satisfies PluginInfo;
    });
  });

  const installedPlugins = marketplacePlugins.filter((plugin) => plugin.installed);
  const marketplaceLoadErrors = [
    ...options.localErrors,
    ...(Array.isArray(options.response.marketplaceLoadErrors)
      ? options.response.marketplaceLoadErrors.flatMap((error) => {
        if (typeof error?.marketplacePath !== "string" || typeof error?.message !== "string") {
          return [];
        }
        return [{ marketplacePath: error.marketplacePath, message: error.message }];
      })
      : [])
  ];

  return {
    catalogs,
    marketplacePlugins,
    installedPlugins,
    marketplaceLoadErrors,
    remoteSyncError: typeof options.response.remoteSyncError === "string" ? options.response.remoteSyncError : null
  };
}

function findPluginInState(state: PluginListState, options: { marketplacePath: string; pluginName: string }): PluginInfo | null {
  return state.marketplacePlugins.find((plugin) => (
    plugin.marketplacePath === options.marketplacePath && plugin.name === options.pluginName
  )) ?? null;
}

function installPluginLocally(options: {
  plugin: PluginInfo;
  sourceKind: PluginCatalogSourceKind;
  codexHomeDir: string;
}): { pluginVersion: string; installedPath: string } {
  const sourcePath = options.plugin.sourcePath;
  if (!sourcePath) {
    throw new Error(`plugin source path is not available for ${options.plugin.id}`);
  }

  const resolvedSourcePath = path.resolve(sourcePath);
  const manifestPath = path.join(resolvedSourcePath, ".codex-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`missing plugin manifest: ${manifestPath}`);
  }

  const pluginVersion = options.sourceKind === "official-curated"
    ? (readCuratedPluginsSha(options.codexHomeDir) ?? "local")
    : "local";
  const installedPath = path.join(
    options.codexHomeDir,
    PLUGIN_CACHE_DIR,
    options.plugin.marketplaceName,
    options.plugin.name,
    pluginVersion
  );

  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  fs.rmSync(installedPath, { recursive: true, force: true });
  fs.cpSync(resolvedSourcePath, installedPath, { recursive: true, force: true });

  return { pluginVersion, installedPath };
}

async function enablePluginInConfig(options: {
  client: CodexAppServerClient;
  pluginId: string;
}): Promise<void> {
  await options.client.request("config/value/write", {
    keyPath: `plugins.${options.pluginId}`,
    value: { enabled: true },
    mergeStrategy: "replace"
  });
}

export class CodexPluginService implements PluginService {
  private readonly logger: Logger;

  constructor(
    private readonly options: {
      workspaceDir: string;
      homeDir: string;
      codexHomeDir: string;
      codexCommand?: string;
      logger?: Logger;
      spawnImpl?: typeof import("node:child_process").spawn;
    }
  ) {
    this.logger = options.logger ?? createLogger("plugins");
  }

  async listPlugins(options: { forceRemoteSync?: boolean } = {}): Promise<PluginActionResult> {
    const sourceResolution = resolvePluginCatalogSources({ workspaceDir: this.options.workspaceDir });
    const client = new CodexAppServerClient({
      homeDir: this.options.homeDir,
      codexHomeDir: this.options.codexHomeDir,
      codexCommand: this.options.codexCommand,
      logger: this.logger,
      spawnImpl: this.options.spawnImpl
    });

    try {
      const response = await client.request<RawPluginListResponse>("plugin/list", {
        cwds: sourceResolution.cwds,
        forceRemoteSync: Boolean(options.forceRemoteSync)
      });
      return {
        ok: true,
        state: mapPluginState({
          response,
          bundledMarketplacePath: sourceResolution.bundledMarketplacePath,
          metadataRecords: readPluginInstallMetadata(this.options.homeDir),
          localErrors: sourceResolution.localErrors,
          codexHomeDir: this.options.codexHomeDir
        })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("plugin_list_failed", { message });
      return {
        ok: false,
        error: {
          code: "PLUGIN_LIST_FAILED",
          message
        }
      };
    } finally {
      client.close();
    }
  }

  async readPlugin(options: { marketplacePath: string; pluginName: string }): Promise<PluginReadResult> {
    const client = new CodexAppServerClient({
      homeDir: this.options.homeDir,
      codexHomeDir: this.options.codexHomeDir,
      codexCommand: this.options.codexCommand,
      logger: this.logger,
      spawnImpl: this.options.spawnImpl
    });

    try {
      const response = await client.request<RawPluginReadResponse>("plugin/read", {
        marketplacePath: options.marketplacePath,
        pluginName: options.pluginName
      });
      if (!response.plugin) {
        return {
          ok: false,
          error: {
            code: "PLUGIN_READ_FAILED",
            message: "plugin/read returned no plugin"
          }
        };
      }

      const metadata = readPluginInstallMetadata(this.options.homeDir).find((record) => record.pluginId === response.plugin?.summary.id) ?? null;
      return {
        ok: true,
        plugin: {
          id: response.plugin.summary.id,
          name: response.plugin.summary.name,
          displayName: response.plugin.summary.interface?.displayName?.trim() || response.plugin.summary.name,
          description: response.plugin.description ?? response.plugin.summary.interface?.shortDescription ?? null,
          marketplaceName: response.plugin.marketplaceName,
          marketplacePath: response.plugin.marketplacePath,
          sourceKind: inferPluginSourceKind(
            response.plugin.marketplacePath,
            path.resolve(this.options.workspaceDir, REPO_MARKETPLACE_RELATIVE_PATH)
          ),
          sourcePath: response.plugin.summary.source?.type === "local" && typeof response.plugin.summary.source.path === "string"
            ? response.plugin.summary.source.path
            : null,
          installed: Boolean(response.plugin.summary.installed),
          enabled: Boolean(response.plugin.summary.enabled),
          installPolicy: normalizeInstallPolicy(response.plugin.summary),
          authPolicy: normalizeAuthPolicy(response.plugin.summary),
          category: response.plugin.summary.interface?.category ?? null,
          capabilities: Array.isArray(response.plugin.summary.interface?.capabilities)
            ? response.plugin.summary.interface.capabilities
            : [],
          featured: false,
          installedVersion: metadata?.installedVersion ?? null,
          installedAt: metadata?.installedAt ?? null,
          userInstalled: metadata !== null
        },
        apps: mapPluginApps(response.plugin.apps)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("plugin_read_failed", { message, ...options });
      return {
        ok: false,
        error: {
          code: "PLUGIN_READ_FAILED",
          message
        }
      };
    } finally {
      client.close();
    }
  }

  async installPlugin(options: {
    marketplacePath: string;
    pluginName: string;
    sourceKind: PluginCatalogSourceKind;
  }): Promise<PluginActionResult> {
    const initialState = await this.listPlugins({ forceRemoteSync: options.sourceKind === "official-curated" });
    if (!initialState.ok) {
      return initialState;
    }
    const knownPlugin = findPluginInState(initialState.state, options);

    const client = new CodexAppServerClient({
      homeDir: this.options.homeDir,
      codexHomeDir: this.options.codexHomeDir,
      codexCommand: this.options.codexCommand,
      logger: this.logger,
      spawnImpl: this.options.spawnImpl
    });

    try {
      const installResponse = await client.request<RawPluginInstallResponse>("plugin/install", {
        marketplacePath: options.marketplacePath,
        pluginName: options.pluginName,
        forceRemoteSync: options.sourceKind === "official-curated"
      });

      const state = await this.listPlugins({ forceRemoteSync: options.sourceKind === "official-curated" });
      if (!state.ok) {
        return state;
      }

      const installedPlugin = findPluginInState(state.state, options) ?? knownPlugin;
      if (installedPlugin) {
        upsertPluginInstallMetadataRecord(this.options.homeDir, {
          pluginId: installedPlugin.id,
          pluginName: installedPlugin.name,
          marketplaceName: installedPlugin.marketplaceName,
          marketplacePath: installedPlugin.marketplacePath,
          sourceKind: options.sourceKind,
          installedVersion: installedPlugin.installedVersion,
          installedAt: Date.now()
        });
      }

      return {
        ok: true,
        state: state.state,
        message: Array.isArray(installResponse.appsNeedingAuth) && installResponse.appsNeedingAuth.length > 0
          ? `${installedPlugin?.displayName ?? options.pluginName} をインストールしました。接続が必要な app があります。Installed plugins から接続してください。`
          : `${installedPlugin?.displayName ?? options.pluginName} をインストールしました。`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (knownPlugin && /missing or invalid plugin manifest/i.test(message)) {
        try {
          installPluginLocally({
            plugin: knownPlugin,
            sourceKind: options.sourceKind,
            codexHomeDir: this.options.codexHomeDir
          });

          const configClient = new CodexAppServerClient({
            homeDir: this.options.homeDir,
            codexHomeDir: this.options.codexHomeDir,
            codexCommand: this.options.codexCommand,
            logger: this.logger,
            spawnImpl: this.options.spawnImpl
          });

          try {
            await enablePluginInConfig({
              client: configClient,
              pluginId: knownPlugin.id
            });
          } finally {
            configClient.close();
          }

          const state = await this.listPlugins({ forceRemoteSync: options.sourceKind === "official-curated" });
          if (!state.ok) {
            return state;
          }

          const installedPlugin = findPluginInState(state.state, options) ?? knownPlugin;
          upsertPluginInstallMetadataRecord(this.options.homeDir, {
            pluginId: installedPlugin.id,
            pluginName: installedPlugin.name,
            marketplaceName: installedPlugin.marketplaceName,
            marketplacePath: installedPlugin.marketplacePath,
            sourceKind: options.sourceKind,
            installedVersion: installedPlugin.installedVersion,
            installedAt: Date.now()
          });

          this.logger.info("plugin_install_fallback_used", {
            pluginId: installedPlugin.id,
            marketplacePath: installedPlugin.marketplacePath
          });

          return {
            ok: true,
            state: state.state,
            message: `${installedPlugin.displayName} をインストールしました。`
          };
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          this.logger.error("plugin_install_fallback_failed", {
            message,
            fallbackMessage,
            ...options
          });
          return {
            ok: false,
            error: {
              code: "PLUGIN_INSTALL_FAILED",
              message: `${message}; fallback failed: ${fallbackMessage}`
            }
          };
        }
      }

      this.logger.error("plugin_install_failed", { message, ...options });
      const formattedError = formatPluginInstallError(message, options.pluginName);
      const state = await this.listPlugins({ forceRemoteSync: options.sourceKind === "official-curated" });
      return {
        ok: false,
        error: formattedError,
        state: state.ok ? state.state : undefined
      };
    } finally {
      client.close();
    }
  }

  async uninstallPlugin(options: {
    pluginId: string;
    sourceKind?: PluginCatalogSourceKind;
  }): Promise<PluginActionResult> {
    const metadataRecord = readPluginInstallMetadata(this.options.homeDir).find((record) => record.pluginId === options.pluginId) ?? null;
    if (!metadataRecord) {
      return {
        ok: false,
        error: {
          code: "PLUGIN_UNINSTALL_NOT_ALLOWED",
          message: "Cannot uninstall bundled or system plugins"
        }
      };
    }

    const sourceKind = options.sourceKind ?? metadataRecord.sourceKind;
    const client = new CodexAppServerClient({
      homeDir: this.options.homeDir,
      codexHomeDir: this.options.codexHomeDir,
      codexCommand: this.options.codexCommand,
      logger: this.logger,
      spawnImpl: this.options.spawnImpl
    });

    try {
      await client.request("plugin/uninstall", {
        pluginId: options.pluginId,
        forceRemoteSync: sourceKind === "official-curated"
      });
      removePluginInstallMetadataRecord(this.options.homeDir, options.pluginId);

      const state = await this.listPlugins({ forceRemoteSync: sourceKind === "official-curated" });
      if (!state.ok) {
        return state;
      }
      return {
        ok: true,
        state: state.state,
        message: `${metadataRecord.pluginName} を削除しました。`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("plugin_uninstall_failed", { message, ...options });
      return {
        ok: false,
        error: {
          code: "PLUGIN_UNINSTALL_FAILED",
          message
        }
      };
    } finally {
      client.close();
    }
  }
}

export function readPluginInstallMetadataForTest(homeDir: string): PluginInstallMetadataRecord[] {
  return readPluginInstallMetadata(homeDir);
}

export function upsertPluginInstallMetadataRecordForTest(homeDir: string, record: PluginInstallMetadataRecord): void {
  upsertPluginInstallMetadataRecord(homeDir, record);
}

export function normalizePluginPoliciesForTest(plugin: RawPluginSummary): {
  installPolicy: PluginInstallPolicy;
  authPolicy: PluginAuthPolicy;
} {
  return {
    installPolicy: normalizeInstallPolicy(plugin),
    authPolicy: normalizeAuthPolicy(plugin)
  };
}