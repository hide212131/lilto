import fs from "node:fs";
import path from "node:path";
import {
  SKILL_SOURCE_FILE,
  collectSkillMarkdownFiles,
  discoverRuntimeSkills,
  isPathWithin,
  readMetadataVersionFromSkillMarkdown,
  type SkillMetadata,
  type SkillSourceRecord
} from "./skill-runtime-discovery";

export type SkillRuntimeSetup = {
  appDataDir: string;
  homeDir?: string;
  codexHomeDir: string;
  appSkillsDir: string;
  bundledSkillsDir: string;
  userSkillsDir: string;
  workspaceDir: string;
  availableSkills: SkillMetadata[];
  updatedSettings: string[];
  removedWorkspaces: string[];
};

const BUNDLED_SKILL_NAMES = ["agent-browser", "skill-creator"] as const;
const MANAGED_SKILLS_CONFIG_START = "# lilto-managed-skills-config:start";
const MANAGED_SKILLS_CONFIG_END = "# lilto-managed-skills-config:end";
const BUNDLED_SKILL_SOURCES: Record<string, string> = {
  "agent-browser": "https://github.com/vercel-labs/agent-browser",
  "skill-creator": "https://github.com/anthropics/skills"
};

function resolveWorkspaceUserSkillsDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".agents", "skills");
}

export function resolveCodexUserSkillsDir(codexHomeDir: string): string {
  return path.join(codexHomeDir, "skills");
}

export function buildManagedSkillEnv(options: {
  codexHomeDir?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (options.codexHomeDir) {
    env.CODEX_HOME = options.codexHomeDir;
  }
  return env;
}

export function resolveCodexHomeDir(appDataDir: string): string {
  return process.env.CODEX_HOME || path.join(appDataDir, "codex");
}

function resolveLegacyAppCodexHomeDir(appDataDir: string): string {
  return path.join(appDataDir, "codex");
}

function cleanupLegacySandboxState(options: {
  appDataDir: string;
  codexHomeDir: string;
}): void {
  const legacyCodexHomeDir = resolveLegacyAppCodexHomeDir(options.appDataDir);
  if (path.resolve(legacyCodexHomeDir) === path.resolve(options.codexHomeDir)) {
    return;
  }

  for (const legacyPath of [
    path.join(legacyCodexHomeDir, ".sandbox"),
    path.join(legacyCodexHomeDir, ".sandbox-bin"),
    path.join(legacyCodexHomeDir, ".sandbox-secrets")
  ]) {
    fs.rmSync(legacyPath, { recursive: true, force: true });
  }
}

function resolveBundledSkillSource(options: {
  projectRoot: string;
  skillName: string;
}): string | null {
  const candidates = [
    path.join(options.projectRoot, "node_modules", "agent-browser", "skills", options.skillName),
    path.join(options.projectRoot, "skills", "bundled", options.skillName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readBundledSkillVersion(skillDir: string): string | null {
  return readMetadataVersionFromSkillMarkdown(path.join(skillDir, "SKILL.md"));
}

function upsertBundledSkillSourceRecord(skillDir: string, sourceUrl: string): void {
  const sourceFile = path.join(skillDir, SKILL_SOURCE_FILE);
  let existing: SkillSourceRecord | null = null;

  try {
    if (fs.existsSync(sourceFile)) {
      existing = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as SkillSourceRecord;
    }
  } catch {
    existing = null;
  }

  const nextRecord: SkillSourceRecord = {
    url: sourceUrl,
    installedAt: existing?.installedAt ?? Date.now(),
    installedVersion: readBundledSkillVersion(skillDir),
    contentHash: existing?.contentHash ?? null,
    etag: existing?.etag ?? null,
    lastModified: existing?.lastModified ?? null,
    commitSha: existing?.commitSha ?? null,
    sourceSkillMtime: existing?.sourceSkillMtime ?? null,
    sourceSkillPath: existing?.sourceSkillPath ?? null
  };

  fs.writeFileSync(sourceFile, `${JSON.stringify(nextRecord, null, 2)}\n`, "utf8");
}

export function ensureBundledSkills(options: {
  bundledSkillsDir: string;
  projectRoot?: string;
}): string[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  fs.mkdirSync(options.bundledSkillsDir, { recursive: true });

  const installed: string[] = [];
  for (const skillName of BUNDLED_SKILL_NAMES) {
    const sourceDir = resolveBundledSkillSource({ projectRoot, skillName });
    if (!sourceDir) {
      throw new Error(`Bundled skill not found: ${skillName}`);
    }
    const targetDir = path.join(options.bundledSkillsDir, skillName);
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
    const sourceUrl = BUNDLED_SKILL_SOURCES[skillName];
    if (sourceUrl) {
      upsertBundledSkillSourceRecord(targetDir, sourceUrl);
    }
    installed.push(path.join(targetDir, "SKILL.md"));
  }

  return installed;
}

function migrateLegacyWorkspaceUserSkills(options: {
  legacyUserSkillsDir: string;
  userSkillsDir: string;
  bundledSkillsDir: string;
}): string[] {
  if (!fs.existsSync(options.legacyUserSkillsDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(options.legacyUserSkillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const migrated: string[] = [];
  fs.mkdirSync(options.userSkillsDir, { recursive: true });

  for (const entry of entries) {
    if (entry.name === ".system") {
      continue;
    }

    const sourceDir = path.join(options.legacyUserSkillsDir, entry.name);
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue;
      try {
        if (!fs.statSync(sourceDir).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
    }

    if (isPathWithin(options.bundledSkillsDir, sourceDir)) {
      continue;
    }

    const targetDir = path.join(options.userSkillsDir, entry.name);
    if (fs.existsSync(targetDir)) {
      continue;
    }

    try {
      fs.cpSync(sourceDir, targetDir, { recursive: true, force: false });
      migrated.push(targetDir);
    } catch {
      // Migration is best-effort and non-destructive; leave legacy content in place.
    }
  }

  return migrated;
}

function collectRepoSkillPaths(workspaceDir: string): string[] {
  const repoSkillRoots = [path.join(workspaceDir, ".codex", "skills")];
  return repoSkillRoots.flatMap((rootDir) => collectSkillMarkdownFiles(rootDir));
}

function renderManagedSkillsConfig(disabledSkillPaths: string[]): string {
  if (disabledSkillPaths.length === 0) {
    return "";
  }

  const body = disabledSkillPaths
    .sort((a, b) => a.localeCompare(b))
    .map((skillPath) => `[[skills.config]]\npath = ${JSON.stringify(skillPath)}\nenabled = false`)
    .join("\n\n");

  return `${MANAGED_SKILLS_CONFIG_START}\n${body}\n${MANAGED_SKILLS_CONFIG_END}\n`;
}

function syncManagedSkillVisibility(options: {
  codexHomeDir: string;
  workspaceDir: string;
}): string[] {
  const configPath = path.join(options.codexHomeDir, "config.toml");
  const managedBlock = renderManagedSkillsConfig(collectRepoSkillPaths(options.workspaceDir));
  let existing = "";
  try {
    if (fs.existsSync(configPath)) {
      existing = fs.readFileSync(configPath, "utf8");
    }
  } catch {
    existing = "";
  }

  const managedPattern = new RegExp(
    `${MANAGED_SKILLS_CONFIG_START}[\\s\\S]*?${MANAGED_SKILLS_CONFIG_END}\\n?`,
    "g"
  );
  const withoutManagedBlock = existing.replace(managedPattern, "").replace(/\n{3,}/g, "\n\n").trim();
  const nextContent = [withoutManagedBlock, managedBlock.trim()].filter(Boolean).join("\n\n").trim();
  const finalContent = nextContent ? `${nextContent}\n` : "";

  if (existing === finalContent) {
    return [];
  }

  fs.mkdirSync(options.codexHomeDir, { recursive: true });
  fs.writeFileSync(configPath, finalContent, "utf8");
  return [configPath];
}

export function setupSkillRuntime(options: {
  appDataDir: string;
  projectName: string;
  workspaceTtlHours?: number;
  homeDir?: string;
  settingsPaths?: string[];
  projectRoot?: string;
}): SkillRuntimeSetup {
  const appDataDir = path.resolve(options.appDataDir);
  const homeDir = options.homeDir ? path.resolve(options.homeDir) : undefined;
  const codexHomeDir = resolveCodexHomeDir(appDataDir);
  cleanupLegacySandboxState({ appDataDir, codexHomeDir });
  const appSkillsDir = resolveCodexUserSkillsDir(codexHomeDir);
  const bundledSkillsDir = path.join(appSkillsDir, ".system");
  const workspaceDir = path.resolve(options.projectRoot ?? process.cwd());
  const userSkillsDir = appSkillsDir;

  ensureBundledSkills({ bundledSkillsDir, projectRoot: options.projectRoot });
  fs.mkdirSync(userSkillsDir, { recursive: true });
  migrateLegacyWorkspaceUserSkills({
    legacyUserSkillsDir: resolveWorkspaceUserSkillsDir(workspaceDir),
    userSkillsDir,
    bundledSkillsDir
  });

  const updatedSettings = syncManagedSkillVisibility({
    codexHomeDir,
    workspaceDir
  });
  const availableSkills = discoverRuntimeSkills({ userSkillsDir, bundledSkillsDir });

  return {
    appDataDir,
    homeDir,
    codexHomeDir,
    appSkillsDir,
    bundledSkillsDir,
    userSkillsDir,
    workspaceDir,
    availableSkills,
    updatedSettings,
    removedWorkspaces: []
  };
}

export function uninstallUserSkill(options: {
  skillFilePath: string;
  userSkillsDir: string;
  projectRoot?: string;
}): { ok: true } | { ok: false; error: string } {
  const skillDir = path.resolve(path.dirname(options.skillFilePath));
  const userSkillsDir = path.resolve(options.userSkillsDir);
  const bundledSkillsDir = path.join(userSkillsDir, ".system");

  if (!skillDir.startsWith(userSkillsDir + path.sep)) {
    return { ok: false, error: "Cannot uninstall bundled or system skills" };
  }

  if (isPathWithin(bundledSkillsDir, skillDir)) {
    return { ok: false, error: "Cannot uninstall bundled or system skills" };
  }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}