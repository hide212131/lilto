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
