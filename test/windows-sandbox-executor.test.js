const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enableWindowsSandboxFeature,
  isWindowsIsolatedExecutionAvailable
} = require("../dist/main/windows-sandbox-executor.js");

test("Windows isolated execution availability follows the platform", () => {
  assert.equal(isWindowsIsolatedExecutionAvailable(), process.platform === "win32");
});

test("legacy Windows Sandbox enable API returns a deprecation error", async () => {
  const result = await enableWindowsSandboxFeature();
  assert.equal(result.ok, false);
  assert.match(result.error, /Windows Sandbox/);
});
