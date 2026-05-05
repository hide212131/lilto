import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createLogger, type Logger } from "./logger";

const execFileAsync = promisify(execFile);

const WINDOWS_ENV_COMPLEMENT_KEYS = ["PATHEXT", "ComSpec", "SystemRoot", "windir", "TEMP", "TMP"] as const;

export const WINDOWS_POWERSHELL_PATHS = [
  "C:\\Program Files\\PowerShell\\7",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0"
];

const WINDOWS_ENVIRONMENT_SCRIPT = [
  "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
  "$machine=[Environment]::GetEnvironmentVariables('Machine')",
  "$user=[Environment]::GetEnvironmentVariables('User')",
  "$merged=@{}",
  "foreach($key in $machine.Keys){$merged[$key]=[string]$machine[$key]}",
  "foreach($key in $user.Keys){$merged[$key]=[string]$user[$key]}",
  "$merged | ConvertTo-Json -Compress"
].join(";");

type EnvironmentSnapshot = Record<string, string>;

type EnvironmentLogger = Pick<Logger, "error">;

export type ResolveCodexProcessEnvironmentOptions = {
  platform?: NodeJS.Platform;
  processEnv?: NodeJS.ProcessEnv;
  codexHomeDir?: string;
  prependPathEntries?: string[];
  appendPathEntries?: string[];
  overrides?: Record<string, string>;
  readWindowsPersistentEnvironment?: () => Promise<EnvironmentSnapshot>;
  logger?: EnvironmentLogger;
};

let cachedWindowsPersistentEnvironment: Promise<EnvironmentSnapshot> | null = null;

function normalizeEnvKey(key: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? key.toLowerCase() : key;
}

function findEnvKey(env: EnvironmentSnapshot, key: string, platform: NodeJS.Platform): string | undefined {
  const target = normalizeEnvKey(key, platform);
  return Object.keys(env).find((candidate) => normalizeEnvKey(candidate, platform) === target);
}

function getEnvValue(env: EnvironmentSnapshot, key: string, platform: NodeJS.Platform): string {
  const actualKey = findEnvKey(env, key, platform);
  return actualKey ? env[actualKey] : "";
}

function setEnvValue(env: EnvironmentSnapshot, key: string, value: string, platform: NodeJS.Platform): void {
  const actualKey = findEnvKey(env, key, platform);
  env[actualKey ?? key] = value;
}

function splitPathEntries(value: string, platform: NodeJS.Platform): string[] {
  const separator = platform === "win32" ? ";" : ":";
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pathEntryKey(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? value.toLowerCase() : value;
}

export function mergePathValues(primaryPath: string, supplementalPath: string, platform = process.platform): string {
  const separator = platform === "win32" ? ";" : ":";
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...splitPathEntries(primaryPath, platform), ...splitPathEntries(supplementalPath, platform)]) {
    const key = pathEntryKey(entry, platform);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }
  return merged.join(separator);
}

function snapshotProcessEnvironment(processEnv: NodeJS.ProcessEnv): EnvironmentSnapshot {
  return Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

export function mergeWindowsEnvironment(baseEnv: EnvironmentSnapshot, persistentEnv: EnvironmentSnapshot): EnvironmentSnapshot {
  const merged = { ...baseEnv };
  const primaryPath = getEnvValue(merged, "PATH", "win32");
  const persistentPath = getEnvValue(persistentEnv, "PATH", "win32");
  if (persistentPath) {
    setEnvValue(merged, "PATH", mergePathValues(primaryPath, persistentPath, "win32"), "win32");
  }

  for (const key of WINDOWS_ENV_COMPLEMENT_KEYS) {
    const current = getEnvValue(merged, key, "win32");
    const fallback = getEnvValue(persistentEnv, key, "win32");
    if (!current && fallback) {
      setEnvValue(merged, key, fallback, "win32");
    }
  }

  return merged;
}

function applyPathEntries(
  env: EnvironmentSnapshot,
  entries: string[] | undefined,
  platform: NodeJS.Platform,
  position: "prepend" | "append"
): void {
  if (!entries || entries.length === 0) {
    return;
  }
  const existingPath = getEnvValue(env, "PATH", platform);
  const addition = entries.join(platform === "win32" ? ";" : ":");
  const nextPath = position === "prepend"
    ? mergePathValues(addition, existingPath, platform)
    : mergePathValues(existingPath, addition, platform);
  setEnvValue(env, "PATH", nextPath, platform);
}

function windowsPowerShellCandidates(processEnv: NodeJS.ProcessEnv): string[] {
  const systemRoot = processEnv.SystemRoot || processEnv.SYSTEMROOT || processEnv.windir || processEnv.WINDIR || "C:\\Windows";
  return [
    path.join("C:\\Program Files\\PowerShell\\7", "pwsh.exe"),
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  ];
}

async function readWindowsPersistentEnvironmentFromShell(processEnv: NodeJS.ProcessEnv): Promise<EnvironmentSnapshot> {
  let lastError: unknown;
  for (const executable of windowsPowerShellCandidates(processEnv)) {
    try {
      const result = await execFileAsync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_ENVIRONMENT_SCRIPT], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      const stdout = result.stdout.trim();
      if (!stdout) {
        throw new Error(`No stdout from ${executable}`);
      }
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [key, value])
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to resolve Windows persistent environment");
}

async function getCachedWindowsPersistentEnvironment(processEnv: NodeJS.ProcessEnv): Promise<EnvironmentSnapshot> {
  if (!cachedWindowsPersistentEnvironment) {
    cachedWindowsPersistentEnvironment = readWindowsPersistentEnvironmentFromShell(processEnv);
  }
  return await cachedWindowsPersistentEnvironment;
}

export async function resolveCodexProcessEnvironment(
  options: ResolveCodexProcessEnvironmentOptions = {}
): Promise<EnvironmentSnapshot> {
  const platform = options.platform ?? process.platform;
  const processEnv = options.processEnv ?? process.env;
  const logger = options.logger ?? createLogger("codex-env");
  let env = snapshotProcessEnvironment(processEnv);

  if (platform === "win32") {
    try {
      const persistentEnv = await (options.readWindowsPersistentEnvironment
        ? options.readWindowsPersistentEnvironment()
        : getCachedWindowsPersistentEnvironment(processEnv));
      env = mergeWindowsEnvironment(env, persistentEnv);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("codex_env_windows_fallback", { message });
    }
  }

  if (options.codexHomeDir) {
    setEnvValue(env, "CODEX_HOME", options.codexHomeDir, platform);
  }

  applyPathEntries(env, options.prependPathEntries, platform, "prepend");
  applyPathEntries(env, options.appendPathEntries, platform, "append");

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    setEnvValue(env, key, value, platform);
  }

  return env;
}

export function resetWindowsPersistentEnvironmentCacheForTest(): void {
  cachedWindowsPersistentEnvironment = null;
}