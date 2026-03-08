const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  ensureDir,
  loadManifest,
  markPlatformState,
  parseArgs,
  releaseDir,
  relativeToRoot,
  rootDir,
  saveManifest,
  upsertArtifact
} = require("./release-common");

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, ...options.env }
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function collectArtifacts(distDir) {
  if (!fs.existsSync(distDir)) {
    return [];
  }
  const allowedExtensions = new Set([".zip", ".blockmap", ".yml", ".yaml", ".exe", ".dmg"]);
  return fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && allowedExtensions.has(path.extname(entry.name)))
    .map((entry) => {
      const nextPath = path.join(distDir, entry.name);
      const stat = fs.statSync(nextPath);
      return {
        path: nextPath,
        size: stat.size
      };
    });
}

function writeWindowsHandoff(version, manifest) {
  const handoffPath = path.join(releaseDir(version), "WINDOWS_HANDOFF.md");
  const lines = [
    "# Windows release handoff",
    "",
    `- Version: ${version}`,
    `- Manifest: ${relativeToRoot(path.join(releaseDir(version), "manifest.json"))}`,
    "",
    "## Windows side steps",
    "1. 作業ブランチを Windows 環境へ checkout する",
    "2. `npm.cmd ci` を実行する",
    "3. Rust を用意して `npm.cmd run package:release:win -- --version " + version + "` を実行する",
    "4. 生成された portable 実行ファイルの起動を確認する",
    "5. 必要に応じて `npm.cmd run publish:release -- --version " + version + " --dry-run` で publish plan を確認する",
    "",
    "## Pending verification",
    ...manifest.platforms.windows.verification.checklist.map((item) => `- [ ] ${item}`)
  ];
  fs.writeFileSync(handoffPath, `${lines.join("\n")}\n`);
  return handoffPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platformArg = args.platform;
  const version = args.version ?? process.env.LILTO_RELEASE_VERSION;
  if (!version) {
    throw new Error("--version or LILTO_RELEASE_VERSION is required");
  }
  if (platformArg !== "mac" && platformArg !== "win") {
    throw new Error("--platform must be mac or win");
  }

  const manifest = loadManifest(version);
  const distDir = path.join(releaseDir(version), "dist");
  fs.rmSync(distDir, { recursive: true, force: true });
  ensureDir(distDir);

  if (platformArg === "win" && (args["prepare-only"] || process.platform !== "win32")) {
    const handoffPath = writeWindowsHandoff(manifest.release.version, manifest);
    markPlatformState(manifest, "windows", "prepare", "ready-for-windows", {
      handoffPath: relativeToRoot(handoffPath),
      hostPlatform: process.platform
    });
    manifest.platforms.windows.handoff = {
      path: relativeToRoot(handoffPath),
      generatedAt: new Date().toISOString(),
      hostPlatform: process.platform
    };
    saveManifest(manifest);
    process.stdout.write(`${relativeToRoot(handoffPath)}\n`);
    return;
  }

  const platform = platformArg === "mac" ? "macos" : "windows";
  const targetFlag = platformArg === "mac" ? "--mac" : "--win";
  const targetName = platformArg === "mac" ? "zip" : "portable";
  manifest.artifacts = manifest.artifacts.filter((artifact) => artifact.platform !== platform);
  manifest.platforms[platform].artifacts = [];

  runCommand(npmCommand(), ["run", "build:native"], { env: { LILTO_NATIVE_BUILD_REQUIRED: "1" } });
  runCommand(npmCommand(), ["run", "build"]);
  runCommand(npxCommand(), [
    "electron-builder",
    targetFlag,
    targetName,
    "--publish",
    "never",
    `-c.directories.output=${distDir}`,
    `-c.extraMetadata.version=${manifest.release.version}`
  ]);

  for (const artifact of collectArtifacts(distDir)) {
    upsertArtifact(manifest, {
      platform,
      fileName: path.basename(artifact.path),
      path: relativeToRoot(artifact.path),
      size: artifact.size,
      generatedAt: new Date().toISOString()
    });
  }

  markPlatformState(manifest, platform, "prepare", "done", { hostPlatform: process.platform });
  markPlatformState(manifest, platform, "package", "done", { hostPlatform: process.platform });
  saveManifest(manifest);
  process.stdout.write(`${relativeToRoot(distDir)}\n`);
}

main();
