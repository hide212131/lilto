const path = require("node:path");

const WINDOWS_CLI_SHIMS = {
  npm: "npm.cmd",
  npx: "npx.cmd",
  openspec: "openspec.cmd"
};

function isWindowsPlatform(platform = process.platform) {
  return platform === "win32";
}

function hasExecutableSuffix(command) {
  const lowered = String(command).toLowerCase();
  return lowered.endsWith(".cmd") || lowered.endsWith(".exe") || lowered.endsWith(".bat") || lowered.endsWith(".ps1");
}

function resolveCliCommand(command, platform = process.platform) {
  const normalized = String(command || "").trim();
  if (!normalized || !isWindowsPlatform(platform)) {
    return normalized;
  }

  if (normalized.includes("/") || normalized.includes("\\") || hasExecutableSuffix(normalized)) {
    return normalized;
  }

  const lowered = normalized.toLowerCase();
  return WINDOWS_CLI_SHIMS[lowered] || normalized;
}

function normalizePathArgValue(value) {
  if (value.includes("://") || value.includes("\\")) {
    return value;
  }

  const localPathPattern = /^(\.{1,2}\/|[A-Za-z]:\/|\/)/;
  if (!localPathPattern.test(value) && !value.includes("/")) {
    return value;
  }

  return value.replace(/\//g, "\\");
}

function normalizeCommandArgs(args, platform = process.platform) {
  if (!isWindowsPlatform(platform)) {
    return [...args];
  }

  return args.map((arg) => {
    const raw = String(arg);
    if (raw.startsWith("--") && raw.includes("=")) {
      const index = raw.indexOf("=");
      return `${raw.slice(0, index + 1)}${normalizePathArgValue(raw.slice(index + 1))}`;
    }
    return normalizePathArgValue(raw);
  });
}

function normalizeWorkingDirectory(cwd, platform = process.platform) {
  const resolved = path.resolve(cwd);
  return isWindowsPlatform(platform) ? path.win32.normalize(resolved) : resolved;
}

module.exports = {
  resolveCliCommand,
  normalizeCommandArgs,
  normalizeWorkingDirectory
};
