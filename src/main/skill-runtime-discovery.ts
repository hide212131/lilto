import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SkillMetadata = {
  name: string;
  description: string;
  parameters: unknown;
  filePath: string;
};

export type SkillSource = "bundled" | "user";

export type SkillInfo = SkillMetadata & {
  source: SkillSource;
  installedVersion: string | null;
};

export type SkillSourceRecord = {
  url: string;
  installedAt: number;
  installedVersion: string | null;
  contentHash?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  commitSha?: string | null;
  sourceSkillMtime?: number | null;
  sourceSkillPath?: string | null;
};

export const SKILL_SOURCE_FILE = ".skill-source.json";

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

export function resolveCliListedSkillPath(skillPath: string): string {
  if (skillPath === "~") {
    return os.homedir();
  }

  if (skillPath.startsWith("~/") || skillPath.startsWith("~\\")) {
    return path.join(os.homedir(), skillPath.slice(2).replace(/[\\/]+/g, path.sep));
  }

  return path.resolve(skillPath);
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

export function collectSkillMarkdownFiles(rootDir: string): string[] {
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

export function isPathWithin(parentDir: string, childPath: string): boolean {
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

export function discoverRuntimeSkills(options: {
  userSkillsDir: string;
  bundledSkillsDir: string;
}): SkillMetadata[] {
  const userSkills = discoverUserSkillMetadata(options);
  const seen = new Set(userSkills.map((skill) => skill.name));
  const bundledSkills = discoverSkillMetadata([options.bundledSkillsDir]).filter(
    (skill) => !seen.has(skill.name)
  );
  return [...userSkills, ...bundledSkills];
}

export function readMetadataVersionFromSkillMarkdown(skillFilePath: string): string | null {
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

export function readInstalledVersionFromSkillDir(skillDir: string): string | null {
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

  for (const skill of discoveredUserSkills) {
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