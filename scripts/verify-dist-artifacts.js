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
const hasSchedulerHelper = artifactPaths.some(
  (file) =>
    file.endsWith("/Resources/bin/scheduler-daemon") ||
    file.endsWith("\\Resources\\bin\\scheduler-daemon.exe") ||
    file.endsWith("\\resources\\bin\\scheduler-daemon.exe")
);
const hasSpeechHelper = artifactPaths.some(
  (file) =>
    file.endsWith("/Resources/bin/speech-transcriber.app/Contents/MacOS/speech-transcriber") ||
    file.endsWith("\\resources\\bin\\speech-transcriber.exe")
);
const codexTarget = process.platform === "darwin"
  ? {
      packageName: `codex-darwin-${process.arch}`,
      triple: process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
      binaryName: "codex"
    }
  : process.platform === "win32"
    ? {
        packageName: `codex-win32-${process.arch}`,
        triple: process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
        binaryName: "codex.exe"
      }
    : null;
const hasCodexBinary = codexTarget && artifactPaths.some((file) => {
  const normalized = file.replace(/\\/g, "/");
  return normalized.endsWith(
    `/app.asar.unpacked/node_modules/@openai/${codexTarget.packageName}/vendor/${codexTarget.triple}/bin/${codexTarget.binaryName}`
  );
});

if (process.platform === "darwin") {
  assert(hasMacInstaller, "macOS installer (.dmg) was not generated");
  assert(hasSchedulerHelper, "scheduler helper was not bundled into the macOS app");
  assert(hasSpeechHelper, "speech helper was not bundled into the macOS app");
  assert(hasCodexBinary, "Codex CLI binary was not unpacked into the macOS app");
}

if (process.platform === "win32") {
  assert(hasWindowsInstaller, "Windows installer (.exe) was not generated");
  assert(hasSchedulerHelper, "scheduler helper was not bundled into the Windows app");
  assert(hasSpeechHelper, "speech helper was not bundled into the Windows app");
  assert(hasCodexBinary, "Codex CLI binary was not unpacked into the Windows app");
}

console.log(JSON.stringify({ artifactCount: files.length, artifacts: artifactPaths }, null, 2));
