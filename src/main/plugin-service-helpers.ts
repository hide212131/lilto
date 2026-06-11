import fs from "node:fs";
import path from "node:path";

type PluginCatalogSourceKind = "official-curated" | "bundled";
type PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";
type PluginAuthPolicy = "ON_INSTALL" | "ON_USE";

type PluginMarketplaceLoadError = {
  marketplacePath: string;
  message: string;
};

export type PluginInstallMetadataRecord = {
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  marketplacePath: string;
  sourceKind: PluginCatalogSourceKind;
  installedVersion: string | null;
  installedAt: number;
};

type PluginInstallMetadataFile = {
  version: 1;
  records: PluginInstallMetadataRecord[];
};

type LocalMarketplaceValidationResult =
  | { ok: true; marketplacePath: string }
  | { ok: false; error: PluginMarketplaceLoadError };

type PluginSourceDescriptor = {
  source?: unknown;
  path?: unknown;
};

type LocalMarketplacePluginEntry = {
  name?: unknown;
  source?: PluginSourceDescriptor;
};

type LocalMarketplaceFile = {
  name?: unknown;
  interface?: { displayName?: unknown } | null;
  plugins?: LocalMarketplacePluginEntry[];
};

export type RawPluginSummary = {
  id: string;
  name: string;
  source?: { type?: string; path?: string } | null;
  installed: boolean;
  enabled: boolean;
  installPolicy?: PluginInstallPolicy;
  install_policy?: PluginInstallPolicy;
  authPolicy?: PluginAuthPolicy;
  auth_policy?: PluginAuthPolicy;
  interface?: {
    displayName?: string | null;
    shortDescription?: string | null;
    category?: string | null;
    capabilities?: string[];
  } | null;
};

export type RawPluginListResponse = {
  marketplaces?: Array<{
    name: string;
    path: string;
    interface?: { displayName?: string | null } | null;
    plugins: RawPluginSummary[];
  }>;
  marketplaceLoadErrors?: Array<{ marketplacePath?: string; message?: string }>;
  remoteSyncError?: string | null;
  featuredPluginIds?: string[];
};

const REPO_MARKETPLACE_RELATIVE_PATH = path.join(".agents", "plugins", "marketplace.json");
const INSTALL_METADATA_FILE = path.join("plugins", "install-metadata.json");
export const PLUGIN_CACHE_DIR = path.join("plugins", "cache");
const CURATED_PLUGINS_SHA_FILE = path.join(".tmp", "plugins.sha");

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function metadataFilePath(homeDir: string): string {
  return path.join(homeDir, INSTALL_METADATA_FILE);
}

export function readCuratedPluginsSha(codexHomeDir: string): string | null {
  const filePath = path.join(codexHomeDir, CURATED_PLUGINS_SHA_FILE);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const sha = fs.readFileSync(filePath, "utf8").trim();
  return sha || null;
}

export function readEnabledPluginIds(codexHomeDir: string): Set<string> {
  const configPath = path.join(codexHomeDir, "config.toml");
  if (!fs.existsSync(configPath)) {
    return new Set();
  }

  const enabledPluginIds = new Set<string>();
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  let currentPluginId: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const headerMatch = trimmed.match(/^\[plugins\."([^"]+)"\]$/);
    if (headerMatch) {
      currentPluginId = headerMatch[1];
      continue;
    }

    if (trimmed.startsWith("[")) {
      currentPluginId = null;
      continue;
    }

    if (currentPluginId && /^enabled\s*=\s*true$/.test(trimmed)) {
      enabledPluginIds.add(currentPluginId);
    }
  }

  return enabledPluginIds;
}

export function hasInstalledPluginCache(codexHomeDir: string, plugin: { marketplaceName: string; name: string }): boolean {
  const pluginBaseRoot = path.join(codexHomeDir, PLUGIN_CACHE_DIR, plugin.marketplaceName, plugin.name);
  if (!fs.existsSync(pluginBaseRoot)) {
    return false;
  }

  try {
    return fs.readdirSync(pluginBaseRoot, { withFileTypes: true }).some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

export function readPluginInstallMetadata(homeDir: string): PluginInstallMetadataRecord[] {
  const filePath = metadataFilePath(homeDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PluginInstallMetadataFile;
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writePluginInstallMetadata(homeDir: string, records: PluginInstallMetadataRecord[]): void {
  const filePath = metadataFilePath(homeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next: PluginInstallMetadataFile = { version: 1, records };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function upsertPluginInstallMetadataRecord(homeDir: string, record: PluginInstallMetadataRecord): void {
  const records = readPluginInstallMetadata(homeDir).filter((candidate) => candidate.pluginId !== record.pluginId);
  records.push(record);
  writePluginInstallMetadata(homeDir, records);
}

export function removePluginInstallMetadataRecord(homeDir: string, pluginId: string): void {
  const records = readPluginInstallMetadata(homeDir).filter((candidate) => candidate.pluginId !== pluginId);
  writePluginInstallMetadata(homeDir, records);
}

function validateLocalMarketplaceFile(marketplacePath: string): LocalMarketplaceValidationResult {
  const resolvedMarketplacePath = path.resolve(marketplacePath);
  if (!fs.existsSync(resolvedMarketplacePath)) {
    return {
      ok: false,
      error: {
        marketplacePath: resolvedMarketplacePath,
        message: "marketplace file was not found"
      }
    };
  }

  let parsed: LocalMarketplaceFile;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedMarketplacePath, "utf8")) as LocalMarketplaceFile;
  } catch (error) {
    return {
      ok: false,
      error: {
        marketplacePath: resolvedMarketplacePath,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }

  if (!Array.isArray(parsed.plugins)) {
    return {
      ok: false,
      error: {
        marketplacePath: resolvedMarketplacePath,
        message: "marketplace file must include a plugins array"
      }
    };
  }

  const marketplaceRoot = path.resolve(path.dirname(resolvedMarketplacePath), "..", "..");
  for (const plugin of parsed.plugins) {
    if (!plugin || typeof plugin !== "object") {
      continue;
    }
    const source = plugin.source;
    if (!source || source.source !== "local") {
      continue;
    }

    if (typeof source.path !== "string") {
      return {
        ok: false,
        error: {
          marketplacePath: resolvedMarketplacePath,
          message: "local plugin source path must be a string"
        }
      };
    }

    if (!source.path.startsWith("./")) {
      return {
        ok: false,
        error: {
          marketplacePath: resolvedMarketplacePath,
          message: "local plugin source path must start with `./`"
        }
      };
    }

    const relativePath = source.path.slice(2);
    if (!relativePath) {
      return {
        ok: false,
        error: {
          marketplacePath: resolvedMarketplacePath,
          message: "local plugin source path must not be empty"
        }
      };
    }

    const resolvedSourcePath = path.resolve(marketplaceRoot, relativePath);
    if (!isPathWithin(marketplaceRoot, resolvedSourcePath)) {
      return {
        ok: false,
        error: {
          marketplacePath: resolvedMarketplacePath,
          message: "local plugin source path must stay within the marketplace root"
        }
      };
    }
  }

  return {
    ok: true,
    marketplacePath: resolvedMarketplacePath
  };
}

export function resolvePluginCatalogSources(options: { workspaceDir: string }): {
  cwds: string[] | undefined;
  bundledMarketplacePath: string | null;
  localErrors: PluginMarketplaceLoadError[];
} {
  const bundledMarketplacePath = path.resolve(options.workspaceDir, REPO_MARKETPLACE_RELATIVE_PATH);
  if (!fs.existsSync(bundledMarketplacePath)) {
    return {
      cwds: undefined,
      bundledMarketplacePath: null,
      localErrors: []
    };
  }

  const validation = validateLocalMarketplaceFile(bundledMarketplacePath);
  if (!validation.ok) {
    return {
      cwds: undefined,
      bundledMarketplacePath,
      localErrors: [validation.error]
    };
  }

  return {
    cwds: [path.resolve(options.workspaceDir)],
    bundledMarketplacePath: validation.marketplacePath,
    localErrors: []
  };
}

export function inferPluginSourceKind(marketplacePath: string, bundledMarketplacePath: string | null): PluginCatalogSourceKind {
  if (bundledMarketplacePath && path.resolve(marketplacePath) === path.resolve(bundledMarketplacePath)) {
    return "bundled";
  }
  return "official-curated";
}

export function normalizeInstallPolicy(plugin: RawPluginSummary): PluginInstallPolicy {
  return plugin.installPolicy ?? plugin.install_policy ?? "AVAILABLE";
}

export function normalizeAuthPolicy(plugin: RawPluginSummary): PluginAuthPolicy {
  return plugin.authPolicy ?? plugin.auth_policy ?? "ON_USE";
}

export function mapPluginApps(apps: Array<{
  id?: string;
  name?: string;
  description?: string | null;
  installUrl?: string | null;
  needsAuth?: boolean;
}> | undefined): Array<{
  id: string;
  name: string;
  description: string | null;
  installUrl: string | null;
  needsAuth: boolean;
}> {
  return Array.isArray(apps)
    ? apps.flatMap((app) => {
      if (typeof app?.id !== "string" || typeof app?.name !== "string") {
        return [];
      }
      return [{
        id: app.id,
        name: app.name,
        description: typeof app.description === "string" ? app.description : null,
        installUrl: typeof app.installUrl === "string" ? app.installUrl : null,
        needsAuth: Boolean(app.needsAuth)
      }];
    })
    : [];
}

export function formatPluginInstallError(message: string, pluginName: string): { code: string; message: string } {
  if (/failed to enable remote plugin/i.test(message) && /NotAllowed/i.test(message)) {
    return {
      code: "PLUGIN_AUTH_REQUIRED",
      message: `${pluginName} はインストール済みですが、接続または承認が未完了です。Installed plugins から接続してください。`
    };
  }

  return {
    code: "PLUGIN_INSTALL_FAILED",
    message
  };
}