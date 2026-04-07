import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type SkillMetadata = {
  name: string;
  description: string;
  parameters: unknown;
  filePath: string;
};

export type SkillRuntimeSetup = {
  homeDir: string;
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
const DEFAULT_CODEX_HOME_DIR = path.join(os.homedir(), ".codex");
const SKILLS_CLI_AGENT = "codex";
const ANSI_ESCAPE_REGEX = /\x1B\[[0-9;]*m/g;
const SKILL_INSTALL_TIMEOUT_MS = 60_000;
const MANAGED_SKILLS_CONFIG_START = "# lilto-managed-skills-config:start";
const MANAGED_SKILLS_CONFIG_END = "# lilto-managed-skills-config:end";
const BUNDLED_SKILL_SOURCES: Record<string, string> = {
  "agent-browser": "https://github.com/vercel-labs/agent-browser",
  "skill-creator": "https://github.com/anthropics/skills"
};

function resolveWorkspaceUserSkillsDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".agents", "skills");
}

function resolveWorkspaceDirFromUserSkillsDir(userSkillsDir: string): string | null {
  const normalized = path.resolve(userSkillsDir);
  const expectedSuffix = path.normalize(path.join(".agents", "skills"));
  if (!normalized.endsWith(expectedSuffix)) {
    return null;
  }

  return path.dirname(path.dirname(normalized));
}

function isManagedProjectUserSkillsDir(userSkillsDir: string, projectRoot?: string): boolean {
  const resolvedProjectRoot = path.resolve(projectRoot ?? resolveWorkspaceDirFromUserSkillsDir(userSkillsDir) ?? process.cwd());
  return path.resolve(userSkillsDir) === path.resolve(resolveWorkspaceUserSkillsDir(resolvedProjectRoot));
}

function resolveSkillsCliPath(projectRoot: string): string {
  try {
    const require = createRequire(__filename);
    return require.resolve("skills/bin/cli.mjs");
  } catch {
    const fallbackPath = path.join(projectRoot, "node_modules", "skills", "bin", "cli.mjs");
    if (!fs.existsSync(fallbackPath)) {
      throw new Error(`skills 繝ｩ繧､繝悶Λ繝ｪ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ: ${fallbackPath}`);
    }
    return fallbackPath;
  }
}

function resolveRuntimeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return process.versions.electron
    ? { ...process.env, ...overrides, ELECTRON_RUN_AS_NODE: "1" }
    : { ...process.env, ...overrides };
}

function buildManagedSkillEnv(options: {
  homeDir?: string;
  codexHomeDir?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (options.homeDir) {
    env.HOME = options.homeDir;
    env.USERPROFILE = options.homeDir;
  }
  if (options.codexHomeDir) {
    env.CODEX_HOME = options.codexHomeDir;
  }
  return env;
}

function runSkillsCliSync(options: {
  args: string[];
  projectRoot?: string;
  envOverrides?: NodeJS.ProcessEnv;
}): { ok: true; stdout: string } | { ok: false; error: string } {
  const projectRoot = options.projectRoot ?? process.cwd();
  let skillsCliPath = "";
  try {
    skillsCliPath = resolveSkillsCliPath(projectRoot);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const stdout = execFileSync(
      process.execPath,
      [skillsCliPath, ...options.args],
      {
        cwd: projectRoot,
        env: resolveRuntimeEnv(options.envOverrides),
        timeout: SKILL_INSTALL_TIMEOUT_MS,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const message = (err.stderr || err.stdout || err.message || String(error)).trim();
    return { ok: false, error: message };
  }
}

function parseSkillEntriesFromListOutput(output: string): Array<{ name: string; skillPath: string }> {
  const entries: Array<{ name: string; skillPath: string }> = [];
  const plain = output.replace(ANSI_ESCAPE_REGEX, "");
  const lines = plain.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^([A-Za-z0-9._-]+)\s+((~|\.{1,2}|\/).+)$/);
    if (match) {
      entries.push({ name: match[1], skillPath: match[2] });
    }
  }

  return entries;
}

export function resolveCliListedSkillPath(skillPath: string): string {
  if (skillPath === "~") {
    return os.homedir();
  }

  if (skillPath.startsWith("~/") || skillPath.startsWith("~\\")) {
    return path.join(os.homedir(), skillPath.slice(2).replace(/[\\/]+/g, path.sep));
  }

  return path.resolve(skillPath);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseInlineValue(raw: string): unknown {
  const value = raw.trim();
  if (!value) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } | null {
  const trimmed = markdown.trimStart();
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  const frontmatter = match[1] ?? "";
  const body = trimmed.slice(match[0].length);

  return { frontmatter, body };
}

export function parseSkillMarkdown(markdown: string, filePath: string): SkillMetadata | null {
  const sections = splitFrontmatter(markdown);
  if (!sections) return null;

  const lines = sections.frontmatter.split(/\r?\n/);
  let name = "";
  let description = "";
  let parameters: unknown = {};

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rest = match[2] ?? "";

    if (key === "name") {
      name = String(parseInlineValue(rest)).trim();
      continue;
    }

    if (key === "description") {
      description = String(parseInlineValue(rest)).trim();
      continue;
    }

    if (key === "parameters") {
      if (rest.trim()) {
        parameters = parseInlineValue(rest);
      } else {
        const block: string[] = [];
        while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
          block.push(lines[i + 1]);
          i += 1;
        }
        const joined = block.join("\n").trim();
        parameters = joined ? joined : {};
      }
    }
  }

  if (!name || !description) return null;

  return {
    name,
    description,
    parameters,
    filePath
  };
}

function collectSkillMarkdownFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];

  const files: string[] = [];
  const stack = [rootDir];
  const visitedDirs = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    try {
      const realCurrent = fs.realpathSync(current);
      if (visitedDirs.has(realCurrent)) {
        continue;
      }
      visitedDirs.add(realCurrent);
    } catch {
      // ignore realpath failures and continue best-effort traversal
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            stack.push(fullPath);
            continue;
          }
        } catch {
          // broken symlink or inaccessible target: skip
        }
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export function discoverSkillMetadata(skillDirs: string[]): SkillMetadata[] {
  const discovered: SkillMetadata[] = [];
  const seen = new Set<string>();

  for (const dir of skillDirs) {
    const skillFiles = collectSkillMarkdownFiles(dir);
    for (const filePath of skillFiles) {
      let content = "";
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const metadata = parseSkillMarkdown(content, filePath);
      if (!metadata || seen.has(metadata.name)) continue;

      seen.add(metadata.name);
      discovered.push(metadata);
    }
  }

  return discovered;
}

function isPathWithin(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function filterOutBundledSkills(skillFiles: string[], bundledSkillsDir: string): string[] {
  return skillFiles.filter((skillFilePath) => !isPathWithin(bundledSkillsDir, skillFilePath));
}

function discoverUserSkillMetadata(options: {
  userSkillsDir: string;
  bundledSkillsDir: string;
}): SkillMetadata[] {
  const skillFiles = filterOutBundledSkills(
    collectSkillMarkdownFiles(options.userSkillsDir),
    options.bundledSkillsDir
  );
  const discovered: SkillMetadata[] = [];
  const seen = new Set<string>();

  for (const filePath of skillFiles) {
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const metadata = parseSkillMarkdown(content, filePath);
    if (!metadata || seen.has(metadata.name)) continue;

    seen.add(metadata.name);
    discovered.push(metadata);
  }

  return discovered;
}

export function resolveCodexHomeDir(appDataDir: string): string {
  void appDataDir;
  return process.env.CODEX_HOME || DEFAULT_CODEX_HOME_DIR;
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

export function setupSkillRuntime(options: {
  appDataDir: string;
  projectName: string;
  workspaceTtlHours?: number;
  homeDir?: string;
  settingsPaths?: string[];
  projectRoot?: string;
}): SkillRuntimeSetup {
  const homeDir = path.resolve(options.appDataDir);
  const codexHomeDir = resolveCodexHomeDir(options.appDataDir);
  cleanupLegacySandboxState({ appDataDir: options.appDataDir, codexHomeDir });
  const appSkillsDir = path.join(codexHomeDir, "skills");
  const bundledSkillsDir = path.join(appSkillsDir, ".system");
  const workspaceDir = path.resolve(options.projectRoot ?? process.cwd());
  const userSkillsDir = resolveWorkspaceUserSkillsDir(workspaceDir);

  ensureBundledSkills({ bundledSkillsDir, projectRoot: options.projectRoot });
  fs.mkdirSync(userSkillsDir, { recursive: true });

  const updatedSettings = syncManagedSkillVisibility({
    codexHomeDir,
    workspaceDir
  });
  const availableSkills = discoverSkillMetadata([userSkillsDir, bundledSkillsDir]);

  return {
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

export type SkillSource = "bundled" | "user";

export type SkillInfo = SkillMetadata & {
  source: SkillSource;
  installedVersion: string | null;
};

function readMetadataVersionFromSkillMarkdown(skillFilePath: string): string | null {
  if (!fs.existsSync(skillFilePath)) {
    return null;
  }

  let content = "";
  try {
    content = fs.readFileSync(skillFilePath, "utf8");
  } catch {
    return null;
  }

  const sections = splitFrontmatter(content);
  if (!sections) {
    return null;
  }

  const lines = sections.frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const inlineMatch = line.match(/^metadata:\s*(.+)$/);
    if (inlineMatch && inlineMatch[1].trim()) {
      const parsed = parseInlineValue(inlineMatch[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const version = (parsed as Record<string, unknown>).version;
        if (typeof version === "string" && version.trim()) {
          return version.trim();
        }
      }
    }

    if (!/^metadata:\s*$/.test(line)) {
      continue;
    }

    while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
      const nestedLine = lines[i + 1] ?? "";
      const versionMatch = nestedLine.match(/^\s+version:\s*(.+)\s*$/);
      if (versionMatch) {
        const parsed = parseInlineValue(versionMatch[1]);
        if (typeof parsed === "string" && parsed.trim()) {
          return parsed.trim();
        }
        return String(parsed).trim();
      }
      i += 1;
    }
  }

  return null;
}

function readInstalledVersionFromSkillDir(skillDir: string): string | null {
  const skillFilePath = path.join(skillDir, "SKILL.md");
  const sourceFile = path.join(skillDir, SKILL_SOURCE_FILE);
  if (!fs.existsSync(sourceFile)) {
    return readMetadataVersionFromSkillMarkdown(skillFilePath);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as SkillSourceRecord;
    if (typeof parsed.installedVersion === "string" && parsed.installedVersion.trim()) {
      return parsed.installedVersion;
    }
    return readMetadataVersionFromSkillMarkdown(skillFilePath);
  } catch {
    return readMetadataVersionFromSkillMarkdown(skillFilePath);
  }
}

export function listSkillsWithSource(options: {
  bundledSkillsDir: string;
  userSkillsDir: string;
  projectRoot?: string;
}): SkillInfo[] {
  const result: SkillInfo[] = [];
  const seen = new Set<string>();

  const discoveredUserSkills = discoverUserSkillMetadata({
    userSkillsDir: options.userSkillsDir,
    bundledSkillsDir: options.bundledSkillsDir
  });
  let userNamesFromCli: Set<string> | null = null;

  if (isManagedProjectUserSkillsDir(options.userSkillsDir, options.projectRoot)) {
    const cliListResult = runSkillsCliSync({
      args: ["list", "--agent", SKILLS_CLI_AGENT],
      projectRoot: options.projectRoot ?? resolveWorkspaceDirFromUserSkillsDir(options.userSkillsDir) ?? process.cwd()
    });

    if (!cliListResult.ok) {
      throw new Error(`skills list failed: ${cliListResult.error}`);
    }

    userNamesFromCli = new Set(
      parseSkillEntriesFromListOutput(cliListResult.stdout)
        .filter((entry) => isPathWithin(path.resolve(options.userSkillsDir), resolveCliListedSkillPath(entry.skillPath)))
        .map((entry) => entry.name)
    );
  }

  for (const skill of discoveredUserSkills) {
    if (userNamesFromCli && !userNamesFromCli.has(skill.name)) {
      continue;
    }
    seen.add(skill.name);
    result.push({
      ...skill,
      source: "user",
      installedVersion: readInstalledVersionFromSkillDir(path.dirname(skill.filePath))
    });
  }

  for (const skill of discoverSkillMetadata([options.bundledSkillsDir])) {
    if (!seen.has(skill.name)) {
      result.push({
        ...skill,
        source: "bundled",
        installedVersion: readMetadataVersionFromSkillMarkdown(skill.filePath)
      });
    }
  }

  return result;
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

  if (!isManagedProjectUserSkillsDir(options.userSkillsDir, options.projectRoot)) {
    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const skillName = path.basename(skillDir);
  if (!skillName) {
    return { ok: false, error: "Invalid skill path" };
  }

  const cliRemoveResult = runSkillsCliSync({
    args: ["remove", skillName, "--agent", SKILLS_CLI_AGENT, "--yes"],
    projectRoot: options.projectRoot ?? resolveWorkspaceDirFromUserSkillsDir(options.userSkillsDir) ?? process.cwd()
  });

  if (!cliRemoveResult.ok) {
    return { ok: false, error: cliRemoveResult.error };
  }

  return { ok: true };
}

async function extractZip(zipFile: string, destDir: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  if (process.platform === "win32") {
    await execFileAsync("powershell", ["-Command", `Expand-Archive -Path "${zipFile}" -DestinationPath "${destDir}" -Force`]);
  } else {
    await execFileAsync("unzip", ["-o", zipFile, "-d", destDir]);
  }
}

const SKILL_SOURCE_FILE = ".skill-source.json";

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

type SkillSourceRecord = {
  url: string;
  installedAt: number;
  installedVersion: string | null;
  /** SHA-256 hash of the downloaded archive content */
  contentHash?: string | null;
  /** HTTP ETag header value captured at install time */
  etag?: string | null;
  /** HTTP Last-Modified header value captured at install time */
  lastModified?: string | null;
  /** Git commit SHA for branch-based installs */
  commitSha?: string | null;
  /** Source SKILL.md mtime (for local path/file installs) */
  sourceSkillMtime?: number | null;
  /** Source SKILL.md absolute path (for local path/file installs) */
  sourceSkillPath?: string | null;
};

type GitHubReleaseInfo = {
  type: "github";
  owner: string;
  repo: string;
  version: string | null;
  /** Branch or tag ref name (used for commit SHA comparison) */
  ref: string | null;
};

type GitLabReleaseInfo = {
  type: "gitlab";
  host: string;
  projectPath: string;
  version: string | null;
  /** Branch or tag ref name (used for commit SHA comparison) */
  ref: string | null;
};

type GitHubRepositoryInfo = {
  type: "github";
  owner: string;
  repo: string;
};

function parseRepositoryUrl(url: string): GitHubRepositoryInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return null;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");
    if (!owner || !repo) {
      return null;
    }

    return { type: "github", owner, repo };
  } catch {
    return null;
  }
}

async function fetchDefaultBranch(info: GitHubRepositoryInfo): Promise<string | null> {
  try {
    const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}`;
    const res = await fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const data = await res.json() as { default_branch?: string };
    return data.default_branch ?? null;
  } catch {
    return null;
  }
}
type GitLabRepositoryInfo = {
  type: "gitlab";
  host: string;
  projectPath: string;
};

function parseGitLabRepositoryUrl(url: string): GitLabRepositoryInfo | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("gitlab")) {
      return null;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    return {
      type: "gitlab",
      host: parsed.origin,
      projectPath: segments.join("/").replace(/\.git$/i, "")
    };
  } catch {
    return null;
  }
}

async function fetchGitLabDefaultBranch(info: GitLabRepositoryInfo): Promise<string | null> {
  try {
    const encodedPath = encodeURIComponent(info.projectPath);
    const apiUrl = `${info.host}/api/v4/projects/${encodedPath}`;
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json() as { default_branch?: string };
    return data.default_branch ?? null;
  } catch {
    return null;
  }
}

type RepositoryHeadInfo = {
  sha: string | null;
  ref: string | null;
};

async function fetchRepositoryHeadInfo(url: string): Promise<RepositoryHeadInfo> {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--symref", url, "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const refLine = lines.find((line) => line.startsWith("ref:") && /\sHEAD$/.test(line));
    const headLine = lines.find((line) => /\sHEAD$/.test(line) && !line.startsWith("ref:"));
    const ref = refLine?.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/)?.[1] ?? null;
    const sha = headLine?.split(/\s+/)[0] ?? null;

    return {
      sha: sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null,
      ref
    };
  } catch {
    // fall through
  }

  const githubRepo = parseRepositoryUrl(url);
  if (githubRepo) {
    const defaultBranch = await fetchDefaultBranch(githubRepo);
    if (!defaultBranch) {
      return { sha: null, ref: null };
    }
    const sha = await fetchLatestCommitSha(
      { type: "github", owner: githubRepo.owner, repo: githubRepo.repo, version: null, ref: defaultBranch },
      defaultBranch
    );
    return { sha, ref: defaultBranch };
  }

  const gitlabRepo = parseGitLabRepositoryUrl(url);
  if (gitlabRepo) {
    const defaultBranch = await fetchGitLabDefaultBranch(gitlabRepo);
    if (!defaultBranch) {
      return { sha: null, ref: null };
    }
    const sha = await fetchLatestCommitSha(
      { type: "gitlab", host: gitlabRepo.host, projectPath: gitlabRepo.projectPath, version: null, ref: defaultBranch },
      defaultBranch
    );
    return { sha, ref: defaultBranch };
  }

  return { sha: null, ref: null };
}

async function fetchLatestRepositoryCommitSha(url: string): Promise<string | null> {
  const headInfo = await fetchRepositoryHeadInfo(url);
  return headInfo.sha;
}

async function fetchArchiveBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function findSkillVersionInDirectory(rootDir: string, skillName: string): string | null {
  const candidatePaths = [
    path.join(rootDir, "skills", skillName, "SKILL.md"),
    path.join(rootDir, skillName, "SKILL.md")
  ];

  for (const candidate of candidatePaths) {
    const version = readMetadataVersionFromSkillMarkdown(candidate);
    if (version) {
      return version;
    }
  }

  return findSkillVersionInExtractedArchive(rootDir, skillName);
}

async function readSkillVersionFromGitClone(sourceUrl: string, skillName: string, ref?: string | null): Promise<string | null> {
  const tmpDir = path.join(os.tmpdir(), `lilto-skill-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const cloneArgs = ["clone", "--depth", "1"];
    if (ref) {
      cloneArgs.push("--branch", ref);
    }
    cloneArgs.push(sourceUrl, tmpDir);
    execFileSync("git", cloneArgs, { stdio: ["ignore", "pipe", "pipe"] });
    return findSkillVersionInDirectory(tmpDir, skillName);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function findSkillVersionInExtractedArchive(extractDir: string, skillName: string): string | null {
  const skillFiles = collectSkillMarkdownFiles(extractDir);
  for (const skillFile of skillFiles) {
    try {
      const content = fs.readFileSync(skillFile, "utf8");
      const metadata = parseSkillMarkdown(content, skillFile);
      if (!metadata || metadata.name !== skillName) {
        continue;
      }
      return readMetadataVersionFromSkillMarkdown(skillFile);
    } catch {
      // best effort
    }
  }
  return null;
}

async function readSkillVersionFromArchiveBuffer(buffer: Buffer, skillName: string): Promise<string | null> {
  const tmpBase = path.join(os.tmpdir(), `lilto-skill-version-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpFile = `${tmpBase}.zip`;
  const extractDir = `${tmpBase}-extract`;

  try {
    fs.writeFileSync(tmpFile, buffer);
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(tmpFile, extractDir);
    return findSkillVersionInExtractedArchive(extractDir, skillName);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function fetchLatestSkillVersionFromRemoteSource(sourceUrl: string, skillName: string): Promise<string | null> {
  const releaseInfo = parseReleaseUrl(sourceUrl);
  if (releaseInfo?.type === "github" && releaseInfo.version === null && releaseInfo.ref !== null) {
    const candidates = [
      `https://raw.githubusercontent.com/${releaseInfo.owner}/${releaseInfo.repo}/${encodeURIComponent(releaseInfo.ref)}/skills/${encodeURIComponent(skillName)}/SKILL.md`,
      `https://raw.githubusercontent.com/${releaseInfo.owner}/${releaseInfo.repo}/${encodeURIComponent(releaseInfo.ref)}/${encodeURIComponent(skillName)}/SKILL.md`
    ];
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate);
        if (!res.ok) continue;
        const markdown = await res.text();
        const tmp = path.join(os.tmpdir(), `lilto-remote-skill-${skillName}-${Date.now()}.md`);
        try {
          fs.writeFileSync(tmp, markdown, "utf8");
          const version = readMetadataVersionFromSkillMarkdown(tmp);
          if (version) return version;
        } finally {
          try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        }
      } catch {
        // try next candidate
      }
    }
    return readSkillVersionFromGitClone(sourceUrl, skillName, releaseInfo.ref);
  }

  const githubRepo = parseRepositoryUrl(sourceUrl);
  if (githubRepo) {
    const headInfo = await fetchRepositoryHeadInfo(sourceUrl);
    if (!headInfo.ref) {
      return null;
    }
    const rawVersion = await fetchLatestSkillVersionFromRemoteSource(
      `https://github.com/${githubRepo.owner}/${githubRepo.repo}/archive/refs/heads/${headInfo.ref}.zip`,
      skillName
    );
    return rawVersion ?? readSkillVersionFromGitClone(sourceUrl, skillName, headInfo.ref);
  }

  const gitlabRepo = parseGitLabRepositoryUrl(sourceUrl);
  if (gitlabRepo) {
    const headInfo = await fetchRepositoryHeadInfo(sourceUrl);
    if (!headInfo.ref) {
      return null;
    }
    const candidates = [
      `${gitlabRepo.host}/${gitlabRepo.projectPath}/-/raw/${encodeURIComponent(headInfo.ref)}/skills/${encodeURIComponent(skillName)}/SKILL.md`,
      `${gitlabRepo.host}/${gitlabRepo.projectPath}/-/raw/${encodeURIComponent(headInfo.ref)}/${encodeURIComponent(skillName)}/SKILL.md`
    ];
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate);
        if (!res.ok) continue;
        const markdown = await res.text();
        const tmp = path.join(os.tmpdir(), `lilto-remote-skill-${skillName}-${Date.now()}.md`);
        try {
          fs.writeFileSync(tmp, markdown, "utf8");
          const version = readMetadataVersionFromSkillMarkdown(tmp);
          if (version) return version;
        } finally {
          try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        }
      } catch {
        // try next candidate
      }
    }
    return readSkillVersionFromGitClone(sourceUrl, skillName, headInfo.ref);
  }

  return null;
}

export function parseReleaseUrl(url: string): GitHubReleaseInfo | GitLabReleaseInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      // /owner/repo/releases/download/vX.Y.Z/file.zip
      const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\//);
      if (m) return { type: "github", owner: m[1], repo: m[2], version: m[3], ref: m[3] };
      // /owner/repo/archive/refs/tags/vX.Y.Z.zip
      const m2 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/refs\/tags\/([^/]+?)(?:\.zip)?$/);
      if (m2) return { type: "github", owner: m2[1], repo: m2[2], version: m2[3], ref: m2[3] };
      // /owner/repo/archive/refs/heads/branch-name.zip (branch, no version)
      const m3 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/refs\/heads\/(.+?)(?:\.zip)?$/);
      if (m3) return { type: "github", owner: m3[1], repo: m3[2], version: null, ref: m3[3] };
      // /owner/repo/archive/shorthand.zip (branch shorthand, no version)
      const m4 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/([^/]+?)(?:\.(?:zip|tar\.gz))?$/);
      if (m4) return { type: "github", owner: m4[1], repo: m4[2], version: null, ref: m4[3] };
    }
    if (parsed.hostname.includes("gitlab")) {
      // /namespace/repo/-/releases/vX.Y.Z/downloads/file.zip
      const m = parsed.pathname.match(/^(\/[^/]+\/[^/]+)\/-\/releases\/([^/]+)\//);
      if (m) return { type: "gitlab", host: parsed.origin, projectPath: m[1].slice(1), version: m[2], ref: m[2] };
      // /namespace/repo/-/archive/vX.Y.Z/file.zip
      const m2 = parsed.pathname.match(/^(\/[^/]+\/[^/]+)\/-\/archive\/([^/]+)\//);
      if (m2) return { type: "gitlab", host: parsed.origin, projectPath: m2[1].slice(1), version: m2[2], ref: m2[2] };
    }
  } catch {
    // invalid URL
  }
  return null;
}

async function fetchLatestReleaseTag(info: GitHubReleaseInfo | GitLabReleaseInfo): Promise<string | null> {
  try {
    if (info.type === "github") {
      const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/releases/latest`;
      const res = await fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return null;
      const data = await res.json() as { tag_name?: string };
      return data.tag_name ?? null;
    }
    if (info.type === "gitlab") {
      const encodedPath = encodeURIComponent(info.projectPath);
      const apiUrl = `${info.host}/api/v4/projects/${encodedPath}/releases?per_page=1`;
      const res = await fetch(apiUrl);
      if (!res.ok) return null;
      const data = await res.json() as Array<{ tag_name?: string }>;
      return data[0]?.tag_name ?? null;
    }
  } catch {
    // network error
  }
  return null;
}

async function fetchLatestCommitSha(
  info: GitHubReleaseInfo | GitLabReleaseInfo,
  ref: string
): Promise<string | null> {
  try {
    if (info.type === "github") {
      const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${encodeURIComponent(ref)}`;
      const res = await fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return null;
      const data = await res.json() as { sha?: string };
      return data.sha ?? null;
    }
    if (info.type === "gitlab") {
      const encodedPath = encodeURIComponent(info.projectPath);
      const apiUrl = `${info.host}/api/v4/projects/${encodedPath}/repository/commits?ref_name=${encodeURIComponent(ref)}&per_page=1`;
      const res = await fetch(apiUrl);
      if (!res.ok) return null;
      const data = await res.json() as Array<{ id?: string }>;
      return data[0]?.id ?? null;
    }
  } catch {
    // network error
  }
  return null;
}

async function fetchHttpUpdateMetadata(url: string): Promise<{ etag: string | null; lastModified: string | null } | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    return {
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  } catch {
    // network error
  }
  return null;
}

function resolveLocalSourcePath(source: string): string | null {
  if (isHttpUrl(source)) {
    return null;
  }

  try {
    const parsed = new URL(source);
    if (parsed.protocol === "file:") {
      return path.resolve(fileURLToPath(parsed));
    }
    return null;
  } catch {
    return path.resolve(source);
  }
}

function collectLocalSourceSkillInfo(source: string): Map<string, { skillPath: string; mtimeMs: number; version: string | null }> {
  const result = new Map<string, { skillPath: string; mtimeMs: number; version: string | null }>();
  const localPath = resolveLocalSourcePath(source);
  if (!localPath || !fs.existsSync(localPath)) {
    return result;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(localPath);
  } catch {
    return result;
  }

  const skillFiles: string[] = [];
  if (stat.isFile() && path.basename(localPath) === "SKILL.md") {
    skillFiles.push(localPath);
  } else if (stat.isDirectory()) {
    skillFiles.push(...collectSkillMarkdownFiles(localPath));
  } else {
    return result;
  }

  for (const skillFile of skillFiles) {
    try {
      const content = fs.readFileSync(skillFile, "utf8");
      const metadata = parseSkillMarkdown(content, skillFile);
      if (!metadata) continue;
      const skillStat = fs.statSync(skillFile);
      result.set(metadata.name, {
        skillPath: path.resolve(skillFile),
        mtimeMs: skillStat.mtimeMs,
        version: readMetadataVersionFromSkillMarkdown(skillFile)
      });
    } catch {
      // best effort
    }
  }

  return result;
}

function resolveSkillSourceMtime(record: SkillSourceRecord, skillName: string): number | null {
  if (record.sourceSkillPath) {
    try {
      return fs.statSync(record.sourceSkillPath).mtimeMs;
    } catch {
      // fall through to best-effort discovery
    }
  }

  const localSourcePath = resolveLocalSourcePath(record.url);
  if (!localSourcePath) {
    return null;
  }

  const sourceInfo = collectLocalSourceSkillInfo(localSourcePath).get(skillName);
  return sourceInfo?.mtimeMs ?? null;
}

function resolveSkillSourceVersion(record: SkillSourceRecord, skillName: string): string | null {
  if (record.sourceSkillPath) {
    const version = readMetadataVersionFromSkillMarkdown(record.sourceSkillPath);
    if (version) {
      return version;
    }
  }

  const localSourcePath = resolveLocalSourcePath(record.url);
  if (!localSourcePath) {
    return null;
  }

  const sourceInfo = collectLocalSourceSkillInfo(localSourcePath).get(skillName);
  return sourceInfo?.version ?? null;
}

export function computeContentHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export type SkillUpdateInfo = {
  skillName: string;
  skillFilePath: string;
  sourceUrl: string;
  source: SkillSource;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** How the update check was performed */
  updateCheckMethod: "release-tag" | "commit-sha" | "etag" | "last-modified" | "content-hash" | "local-skill-mtime" | "none";
};

export async function checkSkillUpdates(options: { userSkillsDir: string; bundledSkillsDir?: string }): Promise<SkillUpdateInfo[]> {
  const results: SkillUpdateInfo[] = [];
  const sources: Array<{ dir: string; source: SkillSource }> = [
    { dir: options.userSkillsDir, source: "user" },
    ...(options.bundledSkillsDir ? [{ dir: options.bundledSkillsDir, source: "bundled" as const }] : [])
  ];
  const seenSkillNames = new Set<string>();

  for (const source of sources) {
    if (!fs.existsSync(source.dir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(source.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (seenSkillNames.has(entry.name)) {
        continue;
      }

      if (!entry.isDirectory()) {
        if (!entry.isSymbolicLink()) continue;
        const linkedPath = path.join(source.dir, entry.name);
        try {
          const linkedStats = fs.statSync(linkedPath);
          if (!linkedStats.isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }
      }

      const skillDir = path.join(source.dir, entry.name);
      const sourceFile = path.join(skillDir, SKILL_SOURCE_FILE);
      const skillMd = path.join(skillDir, "SKILL.md");

      if (!fs.existsSync(sourceFile) || !fs.existsSync(skillMd)) continue;

      let record: SkillSourceRecord;
      try {
        record = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as SkillSourceRecord;
      } catch {
        continue;
      }

      const releaseInfo = parseReleaseUrl(record.url);
      const installedVersion = readInstalledVersionFromSkillDir(skillDir);
      let latestVersion: string | null = null;
      let updateAvailable = false;
      let updateCheckMethod: SkillUpdateInfo["updateCheckMethod"] = "none";

      if (record.sourceSkillMtime !== null && record.sourceSkillMtime !== undefined) {
        const currentSourceMtime = resolveSkillSourceMtime(record, entry.name);
        if (currentSourceMtime !== null) {
          latestVersion = resolveSkillSourceVersion(record, entry.name);
          updateAvailable = currentSourceMtime !== record.sourceSkillMtime;
          updateCheckMethod = "local-skill-mtime";
        }
      }

      if (updateCheckMethod === "none" && releaseInfo && releaseInfo.version !== null) {
        // GitHub/GitLab release tag comparison
        latestVersion = await fetchLatestReleaseTag(releaseInfo);
        updateAvailable = latestVersion !== null && latestVersion !== record.installedVersion;
        updateCheckMethod = "release-tag";
      } else if (updateCheckMethod === "none" && releaseInfo && releaseInfo.ref !== null) {
        // GitHub/GitLab branch: compare latest commit SHA
        const latestSha = await fetchLatestCommitSha(releaseInfo, releaseInfo.ref);
        if (latestSha !== null && record.commitSha !== null && record.commitSha !== undefined) {
          updateAvailable = latestSha !== record.commitSha;
          latestVersion = await fetchLatestSkillVersionFromRemoteSource(record.url, entry.name);
          updateCheckMethod = "commit-sha";
        } else if (latestSha !== null && installedVersion !== null) {
          // Fallback for records without commit SHA: compare SKILL.md version.
          latestVersion = await fetchLatestSkillVersionFromRemoteSource(record.url, entry.name);
          updateAvailable = latestVersion !== null && latestVersion !== installedVersion;
          updateCheckMethod = "commit-sha";
        }
      } else if (updateCheckMethod === "none" && record.commitSha !== null && record.commitSha !== undefined) {
        const latestSha = await fetchLatestRepositoryCommitSha(record.url);
        if (latestSha !== null) {
          updateAvailable = latestSha !== record.commitSha;
          latestVersion = await fetchLatestSkillVersionFromRemoteSource(record.url, entry.name);
          updateCheckMethod = "commit-sha";
        }
      }

      if (updateCheckMethod === "none") {
        // Plain HTTP source: use ETag / Last-Modified / content hash
        const meta = await fetchHttpUpdateMetadata(record.url);
        if (meta) {
          if (record.etag !== null && record.etag !== undefined && meta.etag !== null) {
            updateAvailable = record.etag !== meta.etag;
            updateCheckMethod = "etag";
          } else if (record.lastModified !== null && record.lastModified !== undefined && meta.lastModified !== null) {
            updateAvailable = record.lastModified !== meta.lastModified;
            updateCheckMethod = "last-modified";
          }
        }
        // Fallback: re-download and compare content hash
        if (updateCheckMethod === "none" && record.contentHash !== null && record.contentHash !== undefined) {
          try {
            const res = await fetch(record.url);
            if (res.ok) {
              const freshHash = computeContentHash(Buffer.from(await res.arrayBuffer()));
              updateAvailable = freshHash !== record.contentHash;
              updateCheckMethod = "content-hash";
            }
          } catch {
            // network error - leave updateAvailable = false
          }
        }
      }

      results.push({
        skillName: entry.name,
        skillFilePath: skillMd,
        sourceUrl: record.url,
        source: source.source,
        installedVersion,
        latestVersion,
        updateAvailable,
        updateCheckMethod
      });
      seenSkillNames.add(entry.name);
    }
  }

  return results;
}

export async function installSkillFromSource(options: {
  source: string;
  projectRoot?: string;
  userSkillsDir?: string;
  homeDir?: string;
  codexHomeDir?: string;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const source = options.source.trim();
  if (!source) {
    return { ok: false, error: "source is required" };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const projectRoot = options.projectRoot ?? process.cwd();
  const userSkillsDir = options.userSkillsDir ?? resolveWorkspaceUserSkillsDir(projectRoot);
  const envOverrides = buildManagedSkillEnv({
    homeDir: options.homeDir,
    codexHomeDir: options.codexHomeDir
  });
  const sourceIsHttp = isHttpUrl(source);
  const localSourceSkillInfo = collectLocalSourceSkillInfo(source);
  let namesBeforeInstall: Set<string> | null = null;
  const installStartedAt = Date.now();

  const beforeListResult = runSkillsCliSync({
    args: ["list", "--agent", SKILLS_CLI_AGENT],
    projectRoot,
    envOverrides
  });
  if (beforeListResult.ok) {
    namesBeforeInstall = new Set(
      parseSkillEntriesFromListOutput(beforeListResult.stdout)
        .filter((entry) => isPathWithin(path.resolve(userSkillsDir), resolveCliListedSkillPath(entry.skillPath)))
        .map((entry) => entry.name)
    );
  }

  let skillsCliPath = "";
  try {
    skillsCliPath = resolveSkillsCliPath(projectRoot);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [skillsCliPath, "add", source, "--agent", SKILLS_CLI_AGENT, "--yes"],
      { timeout: SKILL_INSTALL_TIMEOUT_MS, cwd: projectRoot, env: resolveRuntimeEnv(envOverrides) }
    );

    const releaseInfo = parseReleaseUrl(source);
    let commitSha: string | null = null;
    if (sourceIsHttp) {
      if (releaseInfo && releaseInfo.version === null && releaseInfo.ref !== null) {
        commitSha = await fetchLatestCommitSha(releaseInfo, releaseInfo.ref);
      } else if (!releaseInfo) {
        commitSha = await fetchLatestRepositoryCommitSha(source);
      }
    }

    const afterListResult = runSkillsCliSync({
      args: ["list", "--agent", SKILLS_CLI_AGENT],
      projectRoot,
      envOverrides
    });

    if (afterListResult.ok) {
      const namesAfterInstall = new Set(
        parseSkillEntriesFromListOutput(afterListResult.stdout)
          .filter((entry) => isPathWithin(path.resolve(userSkillsDir), resolveCliListedSkillPath(entry.skillPath)))
          .map((entry) => entry.name)
      );
      const addedNames = namesBeforeInstall
        ? [...namesAfterInstall].filter((name) => !namesBeforeInstall?.has(name))
        : [...namesAfterInstall];

      const changedNames = [...namesAfterInstall].filter((name) => {
        const skillDir = path.join(userSkillsDir, name);
        try {
          const stats = fs.statSync(skillDir);
          return stats.mtimeMs >= installStartedAt - 10_000;
        } catch {
          return false;
        }
      });

      const targetNames = addedNames.length > 0 ? addedNames : changedNames;

      for (const skillName of targetNames) {
        const skillDir = path.join(userSkillsDir, skillName);
        const localInfo = localSourceSkillInfo.get(skillName);
        const sourceRecord: SkillSourceRecord = {
          url: source,
          installedAt: Date.now(),
          installedVersion: releaseInfo?.version ?? localInfo?.version ?? readInstalledVersionFromSkillDir(skillDir),
          contentHash: null,
          etag: null,
          lastModified: null,
          commitSha,
          sourceSkillMtime: localInfo?.mtimeMs ?? null,
          sourceSkillPath: localInfo?.skillPath ?? null
        };

        try {
          fs.writeFileSync(path.join(skillDir, SKILL_SOURCE_FILE), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
        } catch {
          // best-effort metadata write
        }
      }
    }

    return { ok: true, output: stdout.trim() || "Skill installed" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const msg = (err.stderr || err.stdout || err.message || String(e)).trim();
    return { ok: false, error: msg };
  }
}

export async function installSkillFromUrl(options: {
  url: string;
  userSkillsDir: string;
}): Promise<{ ok: true; installedSkills: string[] } | { ok: false; error: string }> {
  const url = options.url.trim();

  let data: Buffer;
  let finalUrl = url;
  let etag: string | null = null;
  let lastModified: string | null = null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    finalUrl = res.url || url;
    etag = res.headers.get("etag");
    lastModified = res.headers.get("last-modified");
    data = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, error: `Download failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const releaseInfo = parseReleaseUrl(finalUrl) ?? parseReleaseUrl(url);
  const installedVersion = releaseInfo?.version ?? null;
  const contentHash = computeContentHash(data);

  // For branch-based installs, fetch the latest commit SHA
  let commitSha: string | null = null;
  if (releaseInfo && releaseInfo.version === null && releaseInfo.ref !== null) {
    commitSha = await fetchLatestCommitSha(releaseInfo, releaseInfo.ref);
  }

  const tmpBase = path.join(os.tmpdir(), `lilto-skill-${Date.now()}`);
  const tmpFile = `${tmpBase}.zip`;
  const extractDir = `${tmpBase}-extract`;

  try {
    fs.writeFileSync(tmpFile, data);
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(tmpFile, extractDir);

    const skillFiles = collectSkillMarkdownFiles(extractDir);
    if (skillFiles.length === 0) {
      return { ok: false, error: "No SKILL.md found in the archive" };
    }

    const installedSkills: string[] = [];
    for (const skillFile of skillFiles) {
      const content = fs.readFileSync(skillFile, "utf8");
      const metadata = parseSkillMarkdown(content, skillFile);
      if (!metadata) continue;
      const targetDir = path.join(options.userSkillsDir, metadata.name);
      fs.cpSync(path.dirname(skillFile), targetDir, { recursive: true, force: true });

      const sourceRecord: SkillSourceRecord = {
        url,
        installedAt: Date.now(),
        installedVersion,
        contentHash,
        etag,
        lastModified,
        commitSha
      };
      fs.writeFileSync(path.join(targetDir, SKILL_SOURCE_FILE), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");

      installedSkills.push(metadata.name);
    }

    if (installedSkills.length === 0) {
      return { ok: false, error: "No valid skills found in the archive" };
    }

    return { ok: true, installedSkills };
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function shouldPrioritizeAgentBrowser(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes("browser") ||
    lowered.includes("web") ||
    lowered.includes("site") ||
    text.includes("繝悶Λ繧ｦ繧ｶ") ||
    text.includes("繧ｵ繧､繝・") ||
    text.includes("繧ｦ繧ｧ繝・")
  );
}

export function shouldPrioritizeSkillCreator(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes("make a skill") ||
    lowered.includes("create a skill") ||
    lowered.includes("turn this into a skill") ||
    lowered.includes("skillize") ||
    text.includes("繧ｹ繧ｭ繝ｫ縺ｫ縺励※") ||
    text.includes("繧ｹ繧ｭ繝ｫ蛹悶＠縺ｦ") ||
    text.includes("蜀咲樟縺ｧ縺阪ｋ繧医≧縺ｫ繧ｹ繧ｭ繝ｫ")
  );
}
