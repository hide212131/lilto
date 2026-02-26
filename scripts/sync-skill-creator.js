const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoUrl = "https://github.com/anthropics/skills.git";
const skillCreatorPath = path.join("skills", "skill-creator");
const outputDir = path.resolve(__dirname, "..", "skills", "bundled", "skill-creator");

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  });
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

    fs.cpSync(sourceDir, outputDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  syncWithSparseClone();
  console.log(`Synced latest skill-creator to ${outputDir}`);
}

Promise.resolve()
  .then(() => main())
  .catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
  });
