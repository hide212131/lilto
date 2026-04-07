import fs from "node:fs";
import path from "node:path";

const WINDOWS_CLI_SHIMS = {
  codex: "codex.cmd",
  npm: "npm.cmd",
  npx: "npx.cmd",
  openspec: "openspec.cmd"
} as const;

type CliInvocationSource = "explicit" | "local-bin" | "package-script" | "path";

export type CliInvocation = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  source: CliInvocationSource;
};

function hasExecutableSuffix(command: string): boolean {
  const lowered = command.toLowerCase();
  return lowered.endsWith(".cmd") || lowered.endsWith(".exe") || lowered.endsWith(".bat") || lowered.endsWith(".ps1");
}

function normalizeCommandToken(command: string): string {
  return command.trim();
}

function normalizePathArgValue(value: string): string {
  if (value.includes("://") || value.includes("\\")) {
    return value;
  }

  const localPathPattern = /^(\.{1,2}\/|[A-Za-z]:\/|\/)/;
  if (!localPathPattern.test(value) && !value.includes("/")) {
    return value;
  }

  return value.replace(/\//g, "\\");
}

function normalizeFlagValue(flagArg: string): string {
  const equalIndex = flagArg.indexOf("=");
  if (equalIndex <= 0) return flagArg;

  const key = flagArg.slice(0, equalIndex + 1);
  const value = flagArg.slice(equalIndex + 1);
  return `${key}${normalizePathArgValue(value)}`;
}

export function isWindowsPlatform(platform = process.platform): boolean {
  return platform === "win32";
}

function resolveAppRootDir(baseDir?: string): string {
  if (!baseDir) {
    return path.resolve(__dirname, "..", "..");
  }
  if (/^[A-Za-z]:[\\/]/.test(baseDir)) {
    return path.win32.resolve(baseDir);
  }
  return path.resolve(baseDir);
}

function resolveBundledCodexBinPath(
  platform: NodeJS.Platform,
  baseDir: string,
  pathExists: (filePath: string) => boolean
): string | null {
  const pathModule = isWindowsPlatform(platform) ? path.win32 : path;
  const candidate = pathModule.join(baseDir, "node_modules", ".bin", isWindowsPlatform(platform) ? "codex.cmd" : "codex");
  return pathExists(candidate) ? candidate : null;
}

function resolveBundledCodexScriptPath(
  platform: NodeJS.Platform,
  baseDir: string,
  pathExists: (filePath: string) => boolean
): string | null {
  const pathModule = isWindowsPlatform(platform) ? path.win32 : path;
  const candidate = pathModule.join(baseDir, "node_modules", "@openai", "codex", "bin", "codex.js");
  return pathExists(candidate) ? candidate : null;
}

export function resolveCliCommand(command: string, platform = process.platform): string {
  const normalized = normalizeCommandToken(command);
  if (!normalized) return normalized;

  if (!isWindowsPlatform(platform)) {
    return normalized;
  }

  if (normalized.includes("/") || normalized.includes("\\") || hasExecutableSuffix(normalized)) {
    return normalized;
  }

  const lowered = normalized.toLowerCase();
  return WINDOWS_CLI_SHIMS[lowered as keyof typeof WINDOWS_CLI_SHIMS] ?? normalized;
}

export function resolveCliInvocation(
  command: string,
  args: readonly string[] = [],
  options: {
    platform?: NodeJS.Platform;
    baseDir?: string;
    pathExists?: (filePath: string) => boolean;
  } = {}
): CliInvocation {
  const normalized = normalizeCommandToken(command);
  const platform = options.platform ?? process.platform;
  const normalizedArgs = normalizeCommandArgs(args, platform);

  if (!normalized) {
    return {
      command: normalized,
      args: normalizedArgs,
      source: "explicit"
    };
  }

  if (normalized.includes("/") || normalized.includes("\\") || hasExecutableSuffix(normalized)) {
    return {
      command: normalized,
      args: normalizedArgs,
      source: "explicit"
    };
  }

  if (normalized.toLowerCase() === "codex") {
    const baseDir = resolveAppRootDir(options.baseDir);
    const pathExists = options.pathExists ?? fs.existsSync;
    const pathModule = isWindowsPlatform(platform) ? path.win32 : path;
    const bundledScript = resolveBundledCodexScriptPath(platform, baseDir, pathExists);
    if (bundledScript) {
      return {
        command: process.execPath,
        args: [bundledScript, ...normalizedArgs],
        env: {
          ELECTRON_RUN_AS_NODE: "1"
        },
        source: "package-script"
      };
    }

    const bundledBin = resolveBundledCodexBinPath(platform, baseDir, pathExists);
    if (bundledBin) {
      return {
        command: bundledBin,
        args: normalizedArgs,
        source: "local-bin"
      };
    }

    throw new Error(
      `Bundled Codex CLI not found under ${pathModule.join(baseDir, "node_modules")}. Run npm install to restore @openai/codex.`
    );
  }

  return {
    command: resolveCliCommand(normalized, platform),
    args: normalizedArgs,
    source: "path"
  };
}

export function normalizeCommandArgs(args: readonly string[], platform = process.platform): string[] {
  if (!isWindowsPlatform(platform)) {
    return [...args];
  }

  return args.map((arg) => {
    if (!arg) return arg;
    if (arg.startsWith("--")) {
      return normalizeFlagValue(arg);
    }
    return normalizePathArgValue(arg);
  });
}

export function normalizeWorkingDirectory(cwd: string, platform = process.platform): string {
  const resolved = path.resolve(cwd);
  if (!isWindowsPlatform(platform)) {
    return resolved;
  }
  return path.win32.normalize(resolved);
}

export function createCliCompatibilityMap(platform = process.platform): Record<"codex" | "npm" | "npx" | "openspec", string> {
  let codex = resolveCliCommand("codex", platform);
  try {
    codex = resolveCliInvocation("codex", [], { platform }).command;
  } catch {
    // Keep startup logging non-fatal when dependencies have not been installed yet.
  }

  return {
    codex,
    npm: resolveCliCommand("npm", platform),
    npx: resolveCliCommand("npx", platform),
    openspec: resolveCliCommand("openspec", platform)
  };
}

export function isWindowsExecutionPolicyError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  return (
    text.includes("PSSecurityException") ||
    text.includes("running scripts is disabled") ||
    text.includes("このシステムではスクリプトの実行が無効")
  );
}
