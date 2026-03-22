const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nativeDir = path.join(rootDir, "native", "scheduler-daemon");
const speechHelperDir = path.join(rootDir, "native", "speech-transcriber");
const cargoBin = process.platform === "win32" ? "cargo.exe" : "cargo";

function failOrWarn(message, status = 1) {
  if (process.env.LILTO_NATIVE_BUILD_REQUIRED === "1") {
    console.error(message);
    process.exit(status);
  }
  console.warn(`${message}; continuing because LILTO_NATIVE_BUILD_REQUIRED is not set.`);
}

if (process.platform === "win32") {
  const linkerCheck = spawnSync("where.exe", ["link.exe"], {
    cwd: nativeDir,
    stdio: "ignore"
  });

  if (linkerCheck.status !== 0) {
    failOrWarn(
      "native build skipped: Visual C++ linker (link.exe) was not found. Install Visual Studio Build Tools with C++ support to build scheduler-daemon locally"
    );
    process.exit(0);
  }
}

const result = spawnSync(cargoBin, ["build", "--release"], {
  cwd: nativeDir,
  stdio: "inherit"
});

if (result.status !== 0) {
  failOrWarn(`native build failed (status=${result.status ?? "unknown"})`, result.status ?? 1);
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
