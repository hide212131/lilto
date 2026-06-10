const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sourceRoot = path.join(rootDir, ".claude", "skills");
const targetRoots = [
  path.join(rootDir, ".codex", "skills"),
  path.join(rootDir, ".github", "skills")
];

function listSkillDirectories(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function syncTarget(targetRoot, skillDirs) {
  fs.mkdirSync(targetRoot, { recursive: true });

  for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || skillDirs.includes(entry.name)) {
      continue;
    }
    fs.rmSync(path.join(targetRoot, entry.name), { recursive: true, force: true });
  }

  for (const skillDir of skillDirs) {
    const sourceDir = path.join(sourceRoot, skillDir);
    const targetDir = path.join(targetRoot, skillDir);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Missing source skills directory: ${sourceRoot}`);
  }

  const skillDirs = listSkillDirectories(sourceRoot);
  for (const targetRoot of targetRoots) {
    syncTarget(targetRoot, skillDirs);
  }

  console.log(`Synced ${skillDirs.length} skill definition directories from ${sourceRoot}`);
}

main();