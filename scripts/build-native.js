const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nativeDir = path.join(rootDir, "native", "scheduler-daemon");
const speechHelperDir = path.join(rootDir, "native", "speech-transcriber");
const cargoBin = process.platform === "win32" && process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, ".cargo", "bin", "cargo.exe")
  : process.platform === "win32"
    ? "cargo.exe"
    : "cargo";
const buildEnv = { ...process.env };
const schedulerBinDir = path.join(nativeDir, "bin");
const speechBinDir = path.join(speechHelperDir, "bin");

function failOrWarn(message, status = 1) {
  if (process.env.LILTO_NATIVE_BUILD_REQUIRED === "1") {
    console.error(message);
    process.exit(status);
  }
  console.warn(`${message}; continuing because LILTO_NATIVE_BUILD_REQUIRED is not set.`);
}

function listDirectories(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
}

function tryResolveWindowsBuildPlan() {
  const buildToolsRoot = "C:\\BuildTools\\VC\\Tools\\MSVC";
  if (!fs.existsSync(buildToolsRoot)) {
    return null;
  }

  const sdkRoot = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib";
  const versions = listDirectories(buildToolsRoot);
  const sdkVersions = listDirectories(sdkRoot);

  for (const version of versions) {
    const candidates = [
      {
        targetArch: "arm64",
        targetTriple: "aarch64-pc-windows-msvc",
        cargoToolchain: null,
        linkerDirs: [
          path.join(buildToolsRoot, version, "bin", "Hostarm64", "arm64"),
          path.join(buildToolsRoot, version, "bin", "Hostx64", "arm64")
        ],
        msvcLibDir: path.join(buildToolsRoot, version, "lib", "arm64")
      },
      {
        targetArch: "x64",
        targetTriple: "x86_64-pc-windows-msvc",
        cargoToolchain: process.arch === "arm64" ? "stable-x86_64-pc-windows-msvc" : null,
        linkerDirs: [
          path.join(buildToolsRoot, version, "bin", "Hostarm64", "x64"),
          path.join(buildToolsRoot, version, "bin", "Hostx64", "x64")
        ],
        msvcLibDir: path.join(buildToolsRoot, version, "lib", "x64")
      }
    ];

    for (const candidate of candidates) {
      for (const linkerDir of candidate.linkerDirs) {
        const linker = path.join(linkerDir, "link.exe");
        if (!fs.existsSync(linker) || !fs.existsSync(path.join(candidate.msvcLibDir, "vcruntime.lib"))) {
          continue;
        }

        for (const sdkVersion of sdkVersions) {
          const sdkLibDirs = [
            path.join(sdkRoot, sdkVersion, "ucrt", candidate.targetArch),
            path.join(sdkRoot, sdkVersion, "um", candidate.targetArch)
          ];

          if (sdkLibDirs.every((dirPath) => fs.existsSync(dirPath))) {
            return {
              ...candidate,
              linkerDir,
              sdkLibDirs
            };
          }
        }
      }
    }
  }

  return null;
}

function runCargoBuild(projectDir, buildPlan, binaryName) {
  const args = [];
  if (buildPlan?.cargoToolchain) {
    args.push(`+${buildPlan.cargoToolchain}`);
  }
  args.push("build", "--release");
  if (buildPlan?.targetTriple) {
    args.push("--target", buildPlan.targetTriple);
  }

  const result = spawnSync(cargoBin, args, {
    cwd: projectDir,
    stdio: "inherit",
    env: buildEnv
  });

  if (result.status !== 0) {
    return result;
  }

  const outputDir = buildPlan?.targetTriple
    ? path.join(projectDir, "target", buildPlan.targetTriple, "release")
    : path.join(projectDir, "target", "release");

  return {
    ...result,
    outputPath: path.join(outputDir, binaryName)
  };
}

let windowsBuildPlan = null;
if (process.platform === "win32") {
  windowsBuildPlan = tryResolveWindowsBuildPlan();
  if (!windowsBuildPlan) {
    failOrWarn(
      "native build skipped: no matching Visual C++ toolchain and Windows SDK libraries were found. Install Visual Studio Build Tools with the required target architecture support to build native helpers locally"
    );
    process.exit(0);
  }

  buildEnv.PATH = `${windowsBuildPlan.linkerDir};${buildEnv.PATH ?? ""}`;
  buildEnv.LIB = [windowsBuildPlan.msvcLibDir, ...windowsBuildPlan.sdkLibDirs, buildEnv.LIB]
    .filter(Boolean)
    .join(";");
}

const schedulerBinary = process.platform === "win32" ? "scheduler-daemon.exe" : "scheduler-daemon";
const result = runCargoBuild(nativeDir, windowsBuildPlan, schedulerBinary);

if (result.status !== 0) {
  const reason = result.error ? `${result.error.name}: ${result.error.message}` : `status=${result.status ?? "unknown"}`;
  failOrWarn(`native build failed (${reason})`, result.status ?? 1);
  process.exit(0);
}

fs.mkdirSync(schedulerBinDir, { recursive: true });
fs.copyFileSync(result.outputPath, path.join(schedulerBinDir, schedulerBinary));

if (process.platform === "win32") {
  const speechResult = runCargoBuild(speechHelperDir, windowsBuildPlan, "speech-transcriber.exe");

  if (speechResult.status !== 0) {
    const reason = speechResult.error
      ? `${speechResult.error.name}: ${speechResult.error.message}`
      : `status=${speechResult.status ?? "unknown"}`;
    failOrWarn(`speech helper build failed (${reason})`, speechResult.status ?? 1);
    process.exit(0);
  } else {
    fs.mkdirSync(speechBinDir, { recursive: true });
    fs.copyFileSync(
      speechResult.outputPath,
      path.join(speechBinDir, "speech-transcriber.exe")
    );
  }
}

if (process.platform === "darwin") {
  const appDir = path.join(speechHelperDir, "bin", "speech-transcriber.app");
  const macOsDir = path.join(appDir, "Contents", "MacOS");
  const resourcesDir = path.join(appDir, "Contents", "Resources");
  const outputPath = path.join(macOsDir, "speech-transcriber");
  fs.mkdirSync(macOsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.copyFileSync(path.join(speechHelperDir, "Info.plist"), path.join(appDir, "Contents", "Info.plist"));

  const swiftResult = spawnSync("xcrun", [
    "swiftc",
    "-framework",
    "Foundation",
    "-framework",
    "Speech",
    path.join(speechHelperDir, "main.swift"),
    "-o",
    outputPath
  ], {
    cwd: speechHelperDir,
    stdio: "inherit"
  });

  if (swiftResult.status !== 0) {
    failOrWarn(`speech helper build failed (status=${swiftResult.status ?? "unknown"})`, swiftResult.status ?? 1);
  }

  const codesignResult = spawnSync("codesign", ["--force", "--sign", "-", appDir], {
    cwd: speechHelperDir,
    stdio: "inherit"
  });

  if (codesignResult.status !== 0) {
    failOrWarn(`speech helper codesign failed (status=${codesignResult.status ?? "unknown"})`, codesignResult.status ?? 1);
  }
}
