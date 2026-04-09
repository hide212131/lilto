import fs from "node:fs";
import path from "node:path";

type AppPathOptions = {
  appRoot?: string;
  projectRoot?: string;
  resourcesPath?: string;
  isPackaged?: boolean;
};

type NativeHelperOptions = AppPathOptions & {
  envVar?: string;
  packagedRelativePath: string;
  developmentCandidates: string[];
};

type PackagedCodexOptions = AppPathOptions & {
  platform?: NodeJS.Platform;
  arch?: string;
  pathExists?: (filePath: string) => boolean;
};

const CODEX_PLATFORM_PACKAGE_BY_TARGET = {
  "x86_64-unknown-linux-musl": "codex-linux-x64",
  "aarch64-unknown-linux-musl": "codex-linux-arm64",
  "x86_64-apple-darwin": "codex-darwin-x64",
  "aarch64-apple-darwin": "codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "codex-win32-x64",
  "aarch64-pc-windows-msvc": "codex-win32-arm64"
} as const;

function resolveProjectRoot(projectRoot?: string): string {
  return path.resolve(projectRoot ?? process.cwd());
}

export function resolveAppRoot(options: AppPathOptions = {}): string {
  const envRoot = process.env.LILTO_APP_ROOT?.trim();
  if (envRoot) {
    return path.resolve(envRoot);
  }
  return path.resolve(options.appRoot ?? resolveProjectRoot(options.projectRoot));
}

function resolveResourcesPath(options: AppPathOptions = {}): string | null {
  const envResources = process.env.LILTO_RESOURCES_PATH?.trim();
  if (envResources) {
    return path.resolve(envResources);
  }
  if (options.resourcesPath?.trim()) {
    return path.resolve(options.resourcesPath);
  }
  if (typeof process.resourcesPath === "string" && process.resourcesPath.trim()) {
    return path.resolve(process.resourcesPath);
  }
  return null;
}

function isPackagedApp(options: AppPathOptions = {}): boolean {
  if (typeof options.isPackaged === "boolean") {
    return options.isPackaged;
  }
  return process.env.NODE_ENV === "production";
}

export function resolvePreloadPath(options: AppPathOptions = {}): string {
  return path.join(resolveAppRoot(options), "dist", "preload.js");
}

export function resolveRendererIndexPath(options: AppPathOptions = {}): string {
  return path.join(resolveAppRoot(options), "dist", "renderer", "index.html");
}

export function resolveCronMcpServerPath(options: AppPathOptions = {}): string {
  return path.join(resolveAppRoot(options), "dist", "main", "cron-mcp-server.js");
}

export function resolveMascotPngPath(options: AppPathOptions = {}): string | null {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const candidates = [
    path.join(resolveAppRoot(options), "dist", "renderer", "mascot.png"),
    path.join(projectRoot, "src", "renderer", "public", "mascot.png")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveNativeHelperPath(options: NativeHelperOptions): string {
  const envOverride = options.envVar ? process.env[options.envVar]?.trim() : "";
  if (envOverride) {
    return path.resolve(envOverride);
  }

  const projectRoot = resolveProjectRoot(options.projectRoot);
  const developmentCandidates = options.developmentCandidates.map((candidate) =>
    path.resolve(projectRoot, candidate)
  );
  const resourcesPath = resolveResourcesPath(options);
  const packagedCandidate = resourcesPath ? path.join(resourcesPath, options.packagedRelativePath) : null;

  if (isPackagedApp(options) && packagedCandidate) {
    return packagedCandidate;
  }

  for (const candidate of developmentCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (packagedCandidate && fs.existsSync(packagedCandidate)) {
    return packagedCandidate;
  }

  return packagedCandidate ?? developmentCandidates[0];
}

function resolveCodexTargetTriple(platform: NodeJS.Platform, arch: string): string | null {
  switch (platform) {
    case "linux":
    case "android":
      return arch === "x64" ? "x86_64-unknown-linux-musl" : arch === "arm64" ? "aarch64-unknown-linux-musl" : null;
    case "darwin":
      return arch === "x64" ? "x86_64-apple-darwin" : arch === "arm64" ? "aarch64-apple-darwin" : null;
    case "win32":
      return arch === "x64" ? "x86_64-pc-windows-msvc" : arch === "arm64" ? "aarch64-pc-windows-msvc" : null;
    default:
      return null;
  }
}

export function resolvePackagedCodexBinary(options: PackagedCodexOptions = {}): { command: string; extraPath?: string } | null {
  const appRoot = resolveAppRoot(options);
  if (!appRoot.endsWith(".asar")) {
    return null;
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const targetTriple = resolveCodexTargetTriple(platform, arch);
  if (!targetTriple) {
    return null;
  }

  const packageDirName = CODEX_PLATFORM_PACKAGE_BY_TARGET[targetTriple as keyof typeof CODEX_PLATFORM_PACKAGE_BY_TARGET];
  if (!packageDirName) {
    return null;
  }

  const pathExists = options.pathExists ?? fs.existsSync;
  const unpackedRoot = appRoot.replace(/\.asar$/, ".asar.unpacked");
  const vendorRoot = path.join(unpackedRoot, "node_modules", "@openai", packageDirName, "vendor", targetTriple);
  const binaryName = platform === "win32" ? "codex.exe" : "codex";
  const command = path.join(vendorRoot, "codex", binaryName);
  if (!pathExists(command)) {
    return null;
  }

  const extraPath = path.join(vendorRoot, "path");
  return {
    command,
    extraPath: pathExists(extraPath) ? extraPath : undefined
  };
}
