import path from "node:path";

const WINDOWS_CLI_SHIMS = {
  npm: "npm.cmd",
  npx: "npx.cmd",
  openspec: "openspec.cmd"
} as const;

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

export function createCliCompatibilityMap(platform = process.platform): Record<"npm" | "npx" | "openspec", string> {
  return {
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
