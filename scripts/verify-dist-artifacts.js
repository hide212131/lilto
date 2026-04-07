const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(resolved));
    } else {
      files.push(resolved);
    }
  }
  return files;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const files = walk(releaseDir);
assert(files.length > 0, "release artifacts were not generated");

const artifactPaths = files.map((file) => path.relative(rootDir, file));
const hasMacInstaller = artifactPaths.some((file) => file.endsWith(".dmg"));
const hasWindowsInstaller = artifactPaths.some((file) => file.endsWith(".exe"));
const hasSchedulerHelper = artifactPaths.some((file) => file.endsWith("/Resources/bin/scheduler-daemon") || file.endsWith("\\Resources\\bin\\scheduler-daemon.exe"));
const hasSpeechHelper = artifactPaths.some(
  (file) =>
    file.endsWith("/Resources/bin/speech-transcriber.app/Contents/MacOS/speech-transcriber") ||
    file.endsWith("\\resources\\bin\\speech-transcriber.exe")
);

if (process.platform === "darwin") {
  assert(hasMacInstaller, "macOS installer (.dmg) was not generated");
  assert(hasSchedulerHelper, "scheduler helper was not bundled into the macOS app");
  assert(hasSpeechHelper, "speech helper was not bundled into the macOS app");
}

if (process.platform === "win32") {
  assert(hasWindowsInstaller, "Windows installer (.exe) was not generated");
  assert(hasSchedulerHelper, "scheduler helper was not bundled into the Windows app");
  assert(hasSpeechHelper, "speech helper was not bundled into the Windows app");
}

console.log(JSON.stringify({ artifactCount: files.length, artifacts: artifactPaths }, null, 2));
