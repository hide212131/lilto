const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nativeDir = path.join(rootDir, "native", "scheduler-daemon");
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
