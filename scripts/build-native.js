const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nativeDir = path.join(rootDir, "native", "scheduler-daemon");
const cargoBin = process.platform === "win32" ? "cargo.exe" : "cargo";

const result = spawnSync(cargoBin, ["build", "--release"], {
  cwd: nativeDir,
  stdio: "inherit"
});

if (result.status !== 0) {
  const message = `native build failed (status=${result.status ?? "unknown"})`;
  if (process.env.LILTO_NATIVE_BUILD_REQUIRED === "1") {
    console.error(message);
    process.exit(result.status ?? 1);
  }
  console.warn(`${message}; continuing because LILTO_NATIVE_BUILD_REQUIRED is not set.`);
}
