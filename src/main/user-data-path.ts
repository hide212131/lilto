import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { App } from "electron";

const WINDOWS_USER_DATA_DIR_NAME = "Lilt-o";
const WINDOWS_LEGACY_USER_DATA_DIR_NAMES = ["lilt-o", "Lilt-o"];

function toHostFsPath(targetPath: string): string {
  if (path.sep === "\\") {
    return targetPath;
  }

  return targetPath.replaceAll("\\", path.sep);
}

export function resolveWindowsLocalAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA || path.win32.join(env.USERPROFILE || os.homedir(), "AppData", "Local");
}

export function resolveWindowsUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(resolveWindowsLocalAppDataDir(env), WINDOWS_USER_DATA_DIR_NAME);
}

function resolveLegacyWindowsUserDataDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const roamingAppData = env.APPDATA || path.win32.join(env.USERPROFILE || os.homedir(), "AppData", "Roaming");
  return WINDOWS_LEGACY_USER_DATA_DIR_NAMES.map((dirName) => path.win32.join(roamingAppData, dirName));
}

function migrateLegacyWindowsUserDataDir(targetDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const hostTargetDir = toHostFsPath(targetDir);
  if (fs.existsSync(hostTargetDir)) {
    return;
  }

  const legacyDir = resolveLegacyWindowsUserDataDirs(env).find((candidate) => fs.existsSync(toHostFsPath(candidate)));
  if (!legacyDir) {
    return;
  }

  fs.mkdirSync(path.dirname(hostTargetDir), { recursive: true });
  fs.cpSync(toHostFsPath(legacyDir), hostTargetDir, { recursive: true, errorOnExist: false });
}

export function configureAppUserDataPath(app: App, env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "win32") {
    return;
  }

  const userDataDir = resolveWindowsUserDataDir(env);
  migrateLegacyWindowsUserDataDir(userDataDir, env);
  app.setPath("userData", userDataDir);
}
