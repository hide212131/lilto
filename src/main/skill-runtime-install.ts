import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  type SkillSource,
  type SkillSourceRecord,
  SKILL_SOURCE_FILE,
  collectSkillMarkdownFiles,
  isPathWithin,
  parseSkillMarkdown,
  readInstalledVersionFromSkillDir,
  readMetadataVersionFromSkillMarkdown
} from "./skill-runtime-discovery";
import { resolveCodexUserSkillsDir } from "./skill-runtime-policy";

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
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

type GitHubReleaseInfo = {
  type: "github";
  owner: string;
  repo: string;
  version: string | null;
  ref: string | null;
};

type GitLabReleaseInfo = {
  type: "gitlab";
  host: string;
  projectPath: string;
  version: string | null;
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

  if (releaseInfo?.type === "gitlab" && releaseInfo.version === null && releaseInfo.ref !== null) {
    const candidates = [
      `${releaseInfo.host}/${releaseInfo.projectPath}/-/raw/${encodeURIComponent(releaseInfo.ref)}/skills/${encodeURIComponent(skillName)}/SKILL.md`,
      `${releaseInfo.host}/${releaseInfo.projectPath}/-/raw/${encodeURIComponent(releaseInfo.ref)}/${encodeURIComponent(skillName)}/SKILL.md`
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
      const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\//);
      if (m) return { type: "github", owner: m[1], repo: m[2], version: m[3], ref: m[3] };
      const m2 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/refs\/tags\/([^/]+?)(?:\.zip)?$/);
      if (m2) return { type: "github", owner: m2[1], repo: m2[2], version: m2[3], ref: m2[3] };
      const m3 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/refs\/heads\/(.+?)(?:\.zip)?$/);
      if (m3) return { type: "github", owner: m3[1], repo: m3[2], version: null, ref: m3[3] };
      const m4 = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/([^/]+?)(?:\.(?:zip|tar\.gz))?$/);
      if (m4) return { type: "github", owner: m4[1], repo: m4[2], version: null, ref: m4[3] };
    }
    if (parsed.hostname.includes("gitlab")) {
      const m = parsed.pathname.match(/^(\/[^/]+\/[^/]+)\/-\/releases\/([^/]+)\//);
      if (m) return { type: "gitlab", host: parsed.origin, projectPath: m[1].slice(1), version: m[2], ref: m[2] };
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

async function fetchHttpUpdateMetadata(url: string): Promise<{ etag: string | null; lastModified: string | null } | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    return {
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified")
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

  if (path.isAbsolute(source)) {
    return path.resolve(source);
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

      const skillDir = path.join(source.dir, entry.name);
      if (source.source === "user" && options.bundledSkillsDir && isPathWithin(options.bundledSkillsDir, skillDir)) {
        continue;
      }

      if (!entry.isDirectory()) {
        if (!entry.isSymbolicLink()) continue;
        try {
          const linkedStats = fs.statSync(skillDir);
          if (!linkedStats.isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }
      }

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
          updateAvailable =
            (latestVersion !== null && installedVersion !== null && latestVersion !== installedVersion) ||
            currentSourceMtime !== record.sourceSkillMtime;
          updateCheckMethod = "local-skill-mtime";
        }
      }

      if (updateCheckMethod === "none" && releaseInfo && releaseInfo.version !== null) {
        latestVersion = await fetchLatestReleaseTag(releaseInfo);
        updateAvailable = latestVersion !== null && latestVersion !== record.installedVersion;
        updateCheckMethod = "release-tag";
      } else if (updateCheckMethod === "none" && releaseInfo && releaseInfo.ref !== null) {
        const latestSha = await fetchLatestCommitSha(releaseInfo, releaseInfo.ref);
        if (latestSha !== null && record.commitSha !== null && record.commitSha !== undefined) {
          updateAvailable = latestSha !== record.commitSha;
          latestVersion = await fetchLatestSkillVersionFromRemoteSource(record.url, entry.name);
          updateCheckMethod = "commit-sha";
        } else if (latestSha !== null && installedVersion !== null) {
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

  const codexHomeDir = options.codexHomeDir ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const userSkillsDir = options.userSkillsDir ?? resolveCodexUserSkillsDir(codexHomeDir);

  if (isHttpUrl(source)) {
    const result = await installSkillFromUrl({ url: source, userSkillsDir });
    if (!result.ok) {
      return result;
    }
    return { ok: true, output: `Installed ${result.installedSkills.join(", ")}` };
  }

  const localSourcePath = resolveLocalSourcePath(source);
  if (!localSourcePath || !fs.existsSync(localSourcePath)) {
    return { ok: false, error: `Skill source not found: ${source}` };
  }

  const localSourceSkillInfo = collectLocalSourceSkillInfo(source);
  if (localSourceSkillInfo.size === 0) {
    return { ok: false, error: "No valid SKILL.md found in source" };
  }

  fs.mkdirSync(userSkillsDir, { recursive: true });
  const installedSkills: string[] = [];

  for (const [skillName, localInfo] of localSourceSkillInfo) {
    const skillDir = path.join(userSkillsDir, skillName);
    fs.cpSync(path.dirname(localInfo.skillPath), skillDir, { recursive: true, force: true });

    const sourceRecord: SkillSourceRecord = {
      url: source,
      installedAt: Date.now(),
      installedVersion: localInfo.version ?? readInstalledVersionFromSkillDir(skillDir),
      contentHash: null,
      etag: null,
      lastModified: null,
      commitSha: null,
      sourceSkillMtime: localInfo.mtimeMs,
      sourceSkillPath: localInfo.skillPath
    };

    fs.writeFileSync(path.join(skillDir, SKILL_SOURCE_FILE), `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
    installedSkills.push(skillName);
  }

  return { ok: true, output: `Installed ${installedSkills.join(", ")}` };
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