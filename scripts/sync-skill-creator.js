const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoUrl = "https://github.com/anthropics/skills.git";
const skillCreatorPath = path.join("skills", "skill-creator");
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "skills", "bundled", "skill-creator");

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  });
}

function copySkillCreator(sourceDir) {
  const sourceSkillFile = path.join(sourceDir, "SKILL.md");
  if (!fs.existsSync(sourceSkillFile)) {
    throw new Error(`Missing SKILL.md in source directory: ${sourceDir}`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.cpSync(sourceDir, outputDir, { recursive: true, force: true });
}

function resolveFallbackSourceDir() {
  const candidates = [
    process.env.CODEX_HOME && path.join(process.env.CODEX_HOME, "skills", ".system", "skill-creator"),
    path.join(os.homedir(), ".codex", "skills", ".system", "skill-creator"),
    path.join(rootDir, ".codex", "skills", "skill-creator")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "SKILL.md"))) ?? null;
}

function syncWithSparseClone() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lilt-o-skill-sync-"));
  const cloneDir = path.join(tempRoot, "skills-repo");

  try {
    runGit(["clone", "--depth", "1", "--filter=blob:none", "--sparse", repoUrl, cloneDir], tempRoot);
    runGit(["sparse-checkout", "set", skillCreatorPath], cloneDir);

    const sourceDir = path.join(cloneDir, skillCreatorPath);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Missing source directory after clone: ${sourceDir}`);
    }

    copySkillCreator(sourceDir);
    return "git";
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  try {
    syncWithSparseClone();
    console.log(`Synced latest skill-creator to ${outputDir}`);
    return;
  } catch (error) {
    const fallbackSourceDir = resolveFallbackSourceDir();
    if (!fallbackSourceDir) {
      throw error;
    }

    copySkillCreator(fallbackSourceDir);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Git sync failed (${message}). Reused local skill-creator from ${fallbackSourceDir}.`);
  }
}

Promise.resolve()
  .then(() => main())
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
