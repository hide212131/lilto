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

const BUNDLED_SKILL_NAMES = ["agent-browser", "skill-creator", "liltobook"] as const;

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
