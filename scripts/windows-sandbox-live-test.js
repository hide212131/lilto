const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { resolveCliInvocation } = require("../dist/main/command-compat.js");
const { WindowsSandboxSetupService } = require("../dist/main/windows-sandbox-setup.js");

const LIVE_TIMEOUT_MS = 240_000;
const COMMAND_TIMEOUT_MS = 30_000;

function getLiveMode() {
  return process.env.LILTO_WINDOWS_SANDBOX_MODE === "unelevated" ? "unelevated" : "elevated";
}

function getPrivateDesktop() {
  return process.env.LILTO_WINDOWS_SANDBOX_PRIVATE_DESKTOP !== "0";
}

function createLayout() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-windows-sandbox-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const outsideDir = path.join(rootDir, "outside");
  const codexHomeDir = path.join(rootDir, "codex-home");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.mkdirSync(codexHomeDir, { recursive: true });
  return { rootDir, workspaceDir, outsideDir, codexHomeDir };
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function runSandboxCommand({ workspaceDir, codexHomeDir, mode, privateDesktop, commandArgs }) {
  const invocation = resolveCliInvocation("codex", [], {
    platform: "win32",
    baseDir: path.resolve(__dirname, "..")
  });
  const args = [
    ...invocation.args,
    "sandbox",
    "windows",
    "--full-auto",
    "-c",
    `windows.sandbox=\"${mode}\"`,
    "-c",
    `windows.sandbox_private_desktop=${privateDesktop}`,
    "--",
    ...commandArgs
  ];

  const result = spawnSync(invocation.command, args, {
    cwd: workspaceDir,
    env: {
      ...process.env,
      ...(invocation.env ?? {}),
      CODEX_HOME: codexHomeDir
    },
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function assertSucceeded(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} should succeed. stdout=${result.stdout ?? ""}\nstderr=${result.stderr ?? ""}`
  );
}

function assertFailed(result, label) {
  assert.notEqual(
    result.status,
    0,
    `${label} should fail. stdout=${result.stdout ?? ""}\nstderr=${result.stderr ?? ""}`
  );
}

test(
  "Windows sandbox live smoke test exercises elevated protections",
  {
    skip: process.platform !== "win32",
    timeout: LIVE_TIMEOUT_MS
  },
  async (t) => {
    const mode = getLiveMode();
    const privateDesktop = getPrivateDesktop();
    const { rootDir, workspaceDir, outsideDir, codexHomeDir } = createLayout();

    t.after(() => {
      removeIfExists(rootDir);
    });

    const service = new WindowsSandboxSetupService({
      codexHomeDir,
      workspaceDir,
      platform: "win32",
      logger: { info() {}, error() {} }
    });

    const setupResult = await service.runSetup(mode);
    assert.equal(
      setupResult.ok,
      true,
      setupResult.ok ? "" : `${setupResult.error.code}: ${setupResult.error.message}`
    );

    await t.test("workspace 内への cmd 書き込みは許可される", () => {
      const target = path.join(workspaceDir, "ws-ok.txt");
      removeIfExists(target);
      const result = runSandboxCommand({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        commandArgs: ["cmd", "/c", "echo ok > ws-ok.txt"]
      });

      assertSucceeded(result, "workspace write");
      assert.equal(fs.existsSync(target), true);
    });

    await t.test("workspace 外への cmd 書き込みは拒否される", () => {
      const outsideFile = path.join(outsideDir, "blocked.txt");
      removeIfExists(outsideFile);
      const command = `echo blocked > "${outsideFile}"`;
      const result = runSandboxCommand({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        commandArgs: ["cmd", "/c", command]
      });

      assertFailed(result, "outside write");
      assert.equal(fs.existsSync(outsideFile), false);
    });

    await t.test("named pipe 作成は拒否される", () => {
      const result = runSandboxCommand({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        commandArgs: ["cmd", "/c", "echo hi > \\\\.\\pipe\\lilto_windows_sandbox_live_test"]
      });

      assertFailed(result, "named pipe creation");
    });

    await t.test("raw device access は拒否される", () => {
      const result = runSandboxCommand({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        commandArgs: ["cmd", "/c", "type \\.\PhysicalDrive0"]
      });

      assertFailed(result, "raw device access");
    });
  }
);