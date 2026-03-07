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
  appSkillsDir: string;
  bundledSkillsDir: string;
  userSkillsDir: string;
  workspaceDir: string;
  availableSkills: SkillMetadata[];
  updatedSettings: string[];
  removedWorkspaces: string[];
};

const BUNDLED_SKILL_NAMES = ["agent-browser", "skill-creator"] as const;
const DEFAULT_PI_USER_SKILLS_DIR = path.join(os.homedir(), ".pi", "agent", "skills");
const ANSI_ESCAPE_REGEX = /\x1B\[[0-9;]*m/g;
const SKILL_INSTALL_TIMEOUT_MS = 60_000;

function isDefaultUserSkillsDir(userSkillsDir: string): boolean {
  return path.resolve(userSkillsDir) === path.resolve(DEFAULT_PI_USER_SKILLS_DIR);
}

function resolveSkillsCliPath(projectRoot: string): string {
  try {
    const require = createRequire(__filename);
    return require.resolve("skills/bin/cli.mjs");
  } catch {
    const fallbackPath = path.join(projectRoot, "node_modules", "skills", "bin", "cli.mjs");
    if (!fs.existsSync(fallbackPath)) {
      throw new Error(`skills ライブラリが見つかりません: ${fallbackPath}`);
    }
    return fallbackPath;
  }
}

function resolveRuntimeEnv(): NodeJS.ProcessEnv {
  return process.versions.electron
    ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    : process.env;
}

function runSkillsCliSync(options: {
  args: string[];
  projectRoot?: string;
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
        env: resolveRuntimeEnv(),
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

function parseSkillNamesFromListOutput(output: string): Set<string> {
  const names = new Set<string>();
  const plain = output.replace(ANSI_ESCAPE_REGEX, "");
  const lines = plain.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^([A-Za-z0-9._-]+)\s+((~|\.{1,2}|\/).+)$/);
    if (match) {
      names.add(match[1]);
    }
  }

  return names;
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
  if (!trimmed.startsWith("---\n")) return null;

  const end = trimmed.indexOf("\n---\n");
  if (end < 0) return null;

  return {
    frontmatter: trimmed.slice(4, end),
    body: trimmed.slice(end + 5)
  };
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

function updateSettingsFile(settingsPath: string, skillDir: string): boolean {
  let root: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>;
      }
    } catch {
      root = {};
    }
  }

  const existing = Array.isArray(root.skills)
    ? root.skills.filter((item): item is string => typeof item === "string")
    : [];

  if (existing.includes(skillDir)) {
    return false;
  }

  root.skills = [...existing, skillDir];

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  return true;
}

export function ensureSkillDirInPiSettings(options: {
  skillDir?: string;
  skillDirs?: string[];
  homeDir?: string;
  settingsPaths?: string[];
}): string[] {
  const homeDir = options.homeDir ?? os.homedir();
  const settingsPaths =
    options.settingsPaths ?? [path.join(homeDir, ".pi", "settings.json"), path.join(homeDir, ".pi", "agent", "settings.json")];
  const skillDirs = options.skillDirs ?? (options.skillDir ? [options.skillDir] : []);

  const updated: string[] = [];
  for (const skillDir of skillDirs) {
    for (const settingsPath of settingsPaths) {
      if (updateSettingsFile(settingsPath, skillDir) && !updated.includes(settingsPath)) {
        updated.push(settingsPath);
      }
    }
  }

  return updated;
}

export function resolveWorkspaceDir(projectName: string, homeDir = os.homedir()): string {
  const normalized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "lilt-o";
  return path.join(homeDir, ".pi", "workspaces", normalized);
}

export function cleanupOldWorkspaces(options: {
  workspaceRoot: string;
  currentWorkspaceDir: string;
  ttlHours: number;
}): string[] {
  const removed: string[] = [];
  if (options.ttlHours <= 0 || !fs.existsSync(options.workspaceRoot)) {
    return removed;
  }

  const thresholdMs = Date.now() - options.ttlHours * 60 * 60 * 1000;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(options.workspaceRoot, { withFileTypes: true });
  } catch {
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const workspacePath = path.join(options.workspaceRoot, entry.name);
    if (path.resolve(workspacePath) === path.resolve(options.currentWorkspaceDir)) {
      continue;
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(workspacePath);
    } catch {
      continue;
    }

    if (stats.mtimeMs >= thresholdMs) continue;

    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      removed.push(workspacePath);
    } catch {
      // ignore cleanup errors
    }
  }

  return removed;
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
  const homeDir = options.homeDir ?? os.homedir();
  const appSkillsDir = path.join(options.appDataDir, "skills");
  const bundledSkillsDir = path.join(appSkillsDir, "bundled");
  const userSkillsDir = path.join(homeDir, ".pi", "agent", "skills");

  ensureBundledSkills({ bundledSkillsDir, projectRoot: options.projectRoot });
  fs.mkdirSync(userSkillsDir, { recursive: true });

  const updatedSettings = ensureSkillDirInPiSettings({
    skillDirs: [userSkillsDir, bundledSkillsDir],
    homeDir,
    settingsPaths: options.settingsPaths
  });
  const availableSkills = discoverSkillMetadata([userSkillsDir, bundledSkillsDir]);

  const workspaceDir = resolveWorkspaceDir(options.projectName);
  const workspaceRoot = path.dirname(workspaceDir);
  fs.mkdirSync(workspaceDir, { recursive: true });

  const ttl = options.workspaceTtlHours ?? 24 * 7;
  const removedWorkspaces = cleanupOldWorkspaces({
    workspaceRoot,
    currentWorkspaceDir: workspaceDir,
    ttlHours: ttl
  });

  return {
    appSkillsDir,
    bundledSkillsDir,
    userSkillsDir,
    workspaceDir,
    availableSkills,
    updatedSettings,
    removedWorkspaces
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
}): SkillInfo[] {
  const result: SkillInfo[] = [];
  const seen = new Set<string>();

  const discoveredUserSkills = discoverSkillMetadata([options.userSkillsDir]);
  let userNamesFromCli: Set<string> | null = null;

  if (isDefaultUserSkillsDir(options.userSkillsDir)) {
    const cliListResult = runSkillsCliSync({
      args: ["list", "--global", "--agent", "pi"]
    });

    if (!cliListResult.ok) {
      throw new Error(`skills list failed: ${cliListResult.error}`);
    }

    userNamesFromCli = parseSkillNamesFromListOutput(cliListResult.stdout);
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
}): { ok: true } | { ok: false; error: string } {
  const skillDir = path.resolve(path.dirname(options.skillFilePath));
  const userSkillsDir = path.resolve(options.userSkillsDir);

  if (!skillDir.startsWith(userSkillsDir + path.sep)) {
    return { ok: false, error: "Cannot uninstall bundled or system skills" };
  }

  if (!isDefaultUserSkillsDir(options.userSkillsDir)) {
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
    args: ["remove", skillName, "--global", "--agent", "pi", "--yes"]
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

async function fetchLatestRepositoryCommitSha(url: string): Promise<string | null> {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--symref", url, "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const headLine = lines.find((line) => /\sHEAD$/.test(line) && !line.startsWith("ref:"));
    if (headLine) {
      const sha = headLine.split(/\s+/)[0];
      if (/^[0-9a-f]{40}$/i.test(sha)) {
        return sha;
      }
    }
  } catch {
    // fallback to GitHub API
  }

  const repoInfo = parseRepositoryUrl(url);
  if (!repoInfo) {
    return null;
  }

  const defaultBranch = await fetchDefaultBranch(repoInfo);
  if (!defaultBranch) {
    return null;
  }

  return fetchLatestCommitSha(
    { type: "github", owner: repoInfo.owner, repo: repoInfo.repo, version: null, ref: defaultBranch },
    defaultBranch
  );
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
  const localSourcePath = resolveLocalSourcePath(record.url);
  if (!localSourcePath) {
    return null;
  }

  if (record.sourceSkillPath) {
    try {
      return fs.statSync(record.sourceSkillPath).mtimeMs;
    } catch {
      // fall through to best-effort discovery
    }
  }

  const sourceInfo = collectLocalSourceSkillInfo(localSourcePath).get(skillName);
  return sourceInfo?.mtimeMs ?? null;
}

function resolveSkillSourceVersion(record: SkillSourceRecord, skillName: string): string | null {
  const localSourcePath = resolveLocalSourcePath(record.url);
  if (!localSourcePath) {
    return null;
  }

  if (record.sourceSkillPath) {
    const version = readMetadataVersionFromSkillMarkdown(record.sourceSkillPath);
    if (version) {
      return version;
    }
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
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** How the update check was performed */
  updateCheckMethod: "release-tag" | "commit-sha" | "etag" | "last-modified" | "content-hash" | "local-skill-mtime" | "none";
};

export async function checkSkillUpdates(options: { userSkillsDir: string }): Promise<SkillUpdateInfo[]> {
  const results: SkillUpdateInfo[] = [];
  if (!fs.existsSync(options.userSkillsDir)) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(options.userSkillsDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue;
      const linkedPath = path.join(options.userSkillsDir, entry.name);
      try {
        const linkedStats = fs.statSync(linkedPath);
        if (!linkedStats.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
    }
    const skillDir = path.join(options.userSkillsDir, entry.name);
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
        updateCheckMethod = "commit-sha";
      }
    } else if (updateCheckMethod === "none" && record.commitSha !== null && record.commitSha !== undefined) {
      const latestSha = await fetchLatestRepositoryCommitSha(record.url);
      if (latestSha !== null) {
        updateAvailable = latestSha !== record.commitSha;
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
          // network error – leave updateAvailable = false
        }
      }
    }

    results.push({
      skillName: entry.name,
      skillFilePath: skillMd,
      sourceUrl: record.url,
      installedVersion,
      latestVersion,
      updateAvailable,
      updateCheckMethod
    });
  }

  return results;
}

export async function installSkillFromSource(options: {
  source: string;
  projectRoot?: string;
  userSkillsDir?: string;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const source = options.source.trim();
  if (!source) {
    return { ok: false, error: "source は必須です" };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const projectRoot = options.projectRoot ?? process.cwd();
  const userSkillsDir = options.userSkillsDir ?? DEFAULT_PI_USER_SKILLS_DIR;
  const sourceIsHttp = isHttpUrl(source);
  const localSourceSkillInfo = collectLocalSourceSkillInfo(source);
  let namesBeforeInstall: Set<string> | null = null;
  const installStartedAt = Date.now();

  const beforeListResult = runSkillsCliSync({
    args: ["list", "--global", "--agent", "pi"],
    projectRoot
  });
  if (beforeListResult.ok) {
    namesBeforeInstall = parseSkillNamesFromListOutput(beforeListResult.stdout);
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
      [skillsCliPath, "add", source, "--global", "--agent", "pi", "--yes"],
      { timeout: SKILL_INSTALL_TIMEOUT_MS, cwd: projectRoot, env: resolveRuntimeEnv() }
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
      args: ["list", "--global", "--agent", "pi"],
      projectRoot
    });

    if (afterListResult.ok) {
      const namesAfterInstall = parseSkillNamesFromListOutput(afterListResult.stdout);
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
          installedVersion: releaseInfo?.version ?? localInfo?.version ?? null,
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

    return { ok: true, output: stdout.trim() || "インストール完了" };
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
    text.includes("ブラウザ") ||
    text.includes("サイト") ||
    text.includes("ウェブ")
  );
}

export function shouldPrioritizeSkillCreator(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes("make a skill") ||
    lowered.includes("create a skill") ||
    lowered.includes("turn this into a skill") ||
    lowered.includes("skillize") ||
    text.includes("スキルにして") ||
    text.includes("スキル化して") ||
    text.includes("再現できるようにスキル")
  );
}
