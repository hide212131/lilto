const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCliCompatibilityMap,
  isWindowsExecutionPolicyError,
  normalizeCommandArgs,
  normalizeWorkingDirectory,
  resolveCliCommand,
  resolveCliInvocation
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

test("Windows の codex は .cmd ラッパーより同梱 package script を優先して解決する", () => {
  const invocation = resolveCliInvocation("codex", ["app-server", "--listen", "stdio://"], {
    platform: "win32",
    baseDir: "C:/tmp/lilto",
    pathExists: (filePath) =>
      filePath === "C:\\tmp\\lilto\\node_modules\\.bin\\codex.cmd" ||
      filePath === "C:\\tmp\\lilto\\node_modules\\@openai\\codex\\bin\\codex.js"
  });

  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args[0], "C:\\tmp\\lilto\\node_modules\\@openai\\codex\\bin\\codex.js");
  assert.deepEqual(invocation.args.slice(1), ["app-server", "--listen", "stdio://"]);
  assert.deepEqual(invocation.env, { ELECTRON_RUN_AS_NODE: "1" });
  assert.equal(invocation.source, "package-script");
});

test("codex package script が無い場合は node_modules/.bin ラッパーへフォールバックする", () => {
  const invocation = resolveCliInvocation("codex", ["login"], {
    platform: "win32",
    baseDir: "C:/tmp/lilto",
    pathExists: (filePath) => filePath === "C:\\tmp\\lilto\\node_modules\\.bin\\codex.cmd"
  });

  assert.equal(invocation.command, "C:\\tmp\\lilto\\node_modules\\.bin\\codex.cmd");
  assert.deepEqual(invocation.args, ["login"]);
  assert.equal(invocation.source, "local-bin");
});

test("同梱 codex が無ければ外部 PATH に逃がさず明示エラーにする", () => {
  assert.throws(
    () => resolveCliInvocation("codex", [], { platform: "win32", baseDir: "C:/tmp/lilto", pathExists: () => false }),
    /Bundled Codex CLI not found/
  );
});
