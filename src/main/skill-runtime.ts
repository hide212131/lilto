import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

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
  const userSkillsDir = path.join(homeDir, ".pi", "skills");

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
};

export function listSkillsWithSource(options: {
  bundledSkillsDir: string;
  userSkillsDir: string;
}): SkillInfo[] {
  const result: SkillInfo[] = [];
  const seen = new Set<string>();

  for (const skill of discoverSkillMetadata([options.userSkillsDir])) {
    seen.add(skill.name);
    result.push({ ...skill, source: "user" });
  }

  for (const skill of discoverSkillMetadata([options.bundledSkillsDir])) {
    if (!seen.has(skill.name)) {
      result.push({ ...skill, source: "bundled" });
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

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
};

type GitHubReleaseInfo = {
  type: "github";
  owner: string;
  repo: string;
  version: string | null;
};

type GitLabReleaseInfo = {
  type: "gitlab";
  host: string;
  projectPath: string;
  version: string | null;
};

function parseReleaseUrl(url: string): GitHubReleaseInfo | GitLabReleaseInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      // /owner/repo/releases/download/vX.Y.Z/file.zip
      const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\//);
      if (m) return { type: "github", owner: m[1], repo: m[2], version: m[3] };
      // /owner/repo/archive/refs/tags/vX.Y.Z.zip
      const m2 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/refs\/tags\/([^/]+)\.zip$/);
      if (m2) return { type: "github", owner: m2[1], repo: m2[2], version: m2[3] };
      // /owner/repo/archive/refs/heads/... (branch, no version)
      const m3 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\//);
      if (m3) return { type: "github", owner: m3[1], repo: m3[2], version: null };
    }
    if (parsed.hostname.includes("gitlab")) {
      // /namespace/repo/-/releases/vX.Y.Z/downloads/file.zip
      const m = parsed.pathname.match(/^(\/[^/]+\/[^/]+)\/-\/releases\/([^/]+)\//);
      if (m) return { type: "gitlab", host: parsed.origin, projectPath: m[1].slice(1), version: m[2] };
      // /namespace/repo/-/archive/vX.Y.Z/file.zip
      const m2 = parsed.pathname.match(/^(\/[^/]+\/[^/]+)\/-\/archive\/([^/]+)\//);
      if (m2) return { type: "gitlab", host: parsed.origin, projectPath: m2[1].slice(1), version: m2[2] };
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

export type SkillUpdateInfo = {
  skillName: string;
  skillFilePath: string;
  sourceUrl: string;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
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
    if (!entry.isDirectory()) continue;
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
    let latestVersion: string | null = null;
    if (releaseInfo && releaseInfo.version !== null) {
      latestVersion = await fetchLatestReleaseTag(releaseInfo);
    }

    const updateAvailable = latestVersion !== null && latestVersion !== record.installedVersion;

    results.push({
      skillName: entry.name,
      skillFilePath: skillMd,
      sourceUrl: record.url,
      installedVersion: record.installedVersion,
      latestVersion,
      updateAvailable
    });
  }

  return results;
}

const SKILL_INSTALL_TIMEOUT_MS = 60_000;

export async function installSkillFromSource(options: {
  source: string;
  projectRoot?: string;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const source = options.source.trim();
  if (!source) {
    return { ok: false, error: "source は必須です" };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const projectRoot = options.projectRoot ?? process.cwd();
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

  try {
    const { stdout } = await execFileAsync(
      npxCmd,
      ["skills", "add", source, "--global", "--agent", "pi", "--yes"],
      { timeout: SKILL_INSTALL_TIMEOUT_MS, cwd: projectRoot }
    );
    return { ok: true, output: stdout.trim() || "インストール完了" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const msg = (err.stderr || err.message || String(e)).trim();
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
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    finalUrl = res.url || url;
    data = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, error: `Download failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const releaseInfo = parseReleaseUrl(finalUrl) ?? parseReleaseUrl(url);
  const installedVersion = releaseInfo?.version ?? null;

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

      const sourceRecord: SkillSourceRecord = { url, installedAt: Date.now(), installedVersion };
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
