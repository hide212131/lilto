const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCliCompatibilityMap,
  isWindowsExecutionPolicyError,
  normalizeCommandArgs,
  normalizeWorkingDirectory,
  resolveCliCommand
} = require("../dist/main/command-compat.js");

test("Windows では npm/npx/openspec を .cmd へ解決する", () => {
  const map = createCliCompatibilityMap("win32");
  assert.equal(map.npm, "npm.cmd");
  assert.equal(map.npx, "npx.cmd");
  assert.equal(map.openspec, "openspec.cmd");
});

test("Linux/WSL2 経路では元のコマンド名を維持する", () => {
  const map = createCliCompatibilityMap("linux");
  assert.equal(map.npm, "npm");
  assert.equal(map.npx, "npx");
  assert.equal(map.openspec, "openspec");
  assert.equal(resolveCliCommand("npm", "linux"), "npm");
});

test("Windows でパス引数と cwd を正規化する", () => {
  const args = normalizeCommandArgs(["--output=test/artifacts/electron-e2e.png", "./relative/path.txt"], "win32");
  assert.equal(args[0], "--output=test\\artifacts\\electron-e2e.png");
  assert.equal(args[1], ".\\relative\\path.txt");

  const normalizedCwd = normalizeWorkingDirectory(".", "win32");
  assert.equal(normalizedCwd.includes("/"), false);
});

test("PowerShell 実行ポリシーエラーを検出する", () => {
  const psError = new Error("PSSecurityException: このシステムではスクリプトの実行が無効になっているため");
  assert.equal(isWindowsExecutionPolicyError(psError), true);
  assert.equal(isWindowsExecutionPolicyError(new Error("random error")), false);
});
