const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const testDirectory = path.join(__dirname, "..", "test");
const testFiles = fs
  .readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => path.join(testDirectory, entry.name))
  .sort();

if (testFiles.length === 0) {
  throw new Error(`No unit test files found in ${testDirectory}`);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
