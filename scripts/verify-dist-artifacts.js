const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");
const { verifyWindowsIcon } = require("./verify-windows-icon");

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
  const appExecutablePath = path.join(releaseDir, "win-unpacked", "Lilt-o.exe");
  assert(fs.existsSync(appExecutablePath), "Packaged Windows application executable was not generated");
  verifyWindowsIcon(appExecutablePath, path.join(rootDir, "build", "icon.ico"));
  const expectedInstallerName = `Lilt-o-${require("../package.json").version}-win-x64.exe`;
  const installerPath = files.find((file) => path.basename(file) === expectedInstallerName);
  const latestPath = files.find((file) => path.basename(file) === "latest.yml");
  const appUpdatePath = files.find((file) => /resources[\\/]app-update\.yml$/i.test(file));
  assert(installerPath, `Windows installer was not found: ${expectedInstallerName}`);
  assert(latestPath, "Windows update manifest (latest.yml) was not generated");
  assert(appUpdatePath, "Packaged resources/app-update.yml was not generated");

  const latest = yaml.load(fs.readFileSync(latestPath, "utf8"));
  const appUpdate = yaml.load(fs.readFileSync(appUpdatePath, "utf8"));
  assert(latest && latest.version === require("../package.json").version, "latest.yml version does not match package.json");
  assert(appUpdate?.provider === "github" && appUpdate.owner === "hide212131" && appUpdate.repo === "lilto", "Packaged update provider is incorrect");
  const entry = Array.isArray(latest.files) ? latest.files[0] : latest;
  const installerName = entry?.url || entry?.path;
  assert(typeof installerName === "string" && !path.isAbsolute(installerName) && !installerName.split(/[\\/]/).includes(".."), "latest.yml installer path is invalid");
  const manifestInstallerPath = path.join(path.dirname(latestPath), installerName);
  assert(fs.existsSync(manifestInstallerPath), `latest.yml installer does not exist: ${installerName}`);
  const installerBytes = fs.readFileSync(manifestInstallerPath);
  assert(entry.size === installerBytes.length, "latest.yml installer size does not match");
  const sha512 = crypto.createHash("sha512").update(installerBytes).digest("base64");
  assert(entry.sha512 === sha512, "latest.yml installer SHA-512 does not match");
  const blockMapName = entry.blockMapUrl || `${installerName}.blockmap`;
  assert(fs.existsSync(path.join(path.dirname(latestPath), blockMapName)), `Windows blockmap was not generated: ${blockMapName}`);
  assert(hasSchedulerHelper, "scheduler helper was not bundled into the Windows app");
  assert(hasSpeechHelper, "speech helper was not bundled into the Windows app");
  assert(hasCodexBinary, "Codex CLI binary was not unpacked into the Windows app");
}

console.log(JSON.stringify({ artifactCount: files.length, artifacts: artifactPaths }, null, 2));
