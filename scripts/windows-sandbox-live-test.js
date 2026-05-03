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
const SKILL_COMMAND_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = Number(process.env.LILTO_WINDOWS_SANDBOX_SETUP_TIMEOUT_MS || 300_000);
const DEFAULT_TEST_URL = "https://example.com/";
const REPO_FIXTURE_BIN_DIR = path.resolve(__dirname, "..", "test", "fixtures", "sandbox-bin");

function getLiveMode() {
  return process.env.LILTO_WINDOWS_SANDBOX_MODE === "unelevated" ? "unelevated" : "elevated";
}

function getPrivateDesktop() {
  return process.env.LILTO_WINDOWS_SANDBOX_PRIVATE_DESKTOP === "1";
}

function createLayout() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-windows-sandbox-"));
  const outsideDir = fs.mkdtempSync(path.join(os.homedir(), "lilto-windows-sandbox-outside-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const codexHomeDir = path.join(rootDir, "codex-home");
  const fixtureBinDir = REPO_FIXTURE_BIN_DIR;
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(codexHomeDir, { recursive: true });
  fs.mkdirSync(fixtureBinDir, { recursive: true });
  return { rootDir, workspaceDir, outsideDir, codexHomeDir, fixtureBinDir };
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function tomlString(value) {
  return JSON.stringify(value);
}

function writeSandboxConfig({ codexHomeDir, mode, privateDesktop, tempRoot, fixtureBinDir }) {
  const configPath = path.join(codexHomeDir, "config.toml");
  const content = [
    'sandbox_mode = "workspace-write"',
    "",
    "[windows]",
    `sandbox = ${tomlString(mode)}`,
    `sandbox_private_desktop = ${privateDesktop}`,
    "",
    "[sandbox_workspace_write]",
    "network_access = true",
    "writable_roots = [",
    `  ${tomlString(tempRoot)},`,
    `  ${tomlString(fixtureBinDir)},`,
    "]",
    "exclude_tmpdir_env_var = false",
    "exclude_slash_tmp = false",
    ""
  ].join("\n");
  fs.mkdirSync(codexHomeDir, { recursive: true });
  fs.writeFileSync(configPath, content, "utf8");
  return configPath;
}

function findWindowsFixtureSource() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    path.join(systemRoot, "System32", "where.exe"),
    path.join(systemRoot, "System32", "whoami.exe")
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(`No Windows fixture executable found. Checked: ${candidates.join(", ")}`);
  }
  return source;
}

function prepareFixtureExe(fixtureBinDir) {
  const fixtureExe = path.join(fixtureBinDir, "lilto-sandbox-fixture.exe");
  fs.copyFileSync(findWindowsFixtureSource(), fixtureExe);
  const aclResult = spawnSync("icacls", [fixtureBinDir, "/grant", "*S-1-1-0:(OI)(CI)RX"], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(
    aclResult.status,
    0,
    `grant fixture dir RX should succeed. stdout=${aclResult.stdout ?? ""}\nstderr=${aclResult.stderr ?? ""}`
  );
  return fixtureExe;
}

function runSandboxCommand({
  workspaceDir,
  codexHomeDir,
  mode,
  privateDesktop,
  commandArgs,
  env = {},
  timeout = COMMAND_TIMEOUT_MS
}) {
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
      CODEX_HOME: codexHomeDir,
      ...env
    },
    encoding: "utf8",
    timeout,
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function runSandboxSkillOperation({ workspaceDir, codexHomeDir, mode, privateDesktop, fixtureExe, outsideFile }) {
  const skillScript = path.resolve(
    __dirname,
    "..",
    "test",
    "fixtures",
    "skills",
    "windows-sandbox-operation",
    "scripts",
    "run-operation.js"
  );
  const setupResult = runSandboxCommand({
    workspaceDir,
    codexHomeDir,
    mode,
    privateDesktop,
    commandArgs: [process.execPath, skillScript],
    timeout: SKILL_COMMAND_TIMEOUT_MS,
    env: {
      LILTO_SANDBOX_FIXTURE_EXE: fixtureExe,
      LILTO_SANDBOX_OUTSIDE_FILE: outsideFile,
      LILTO_SANDBOX_TEST_URL: process.env.LILTO_SANDBOX_TEST_URL || DEFAULT_TEST_URL
    }
  });
  if (setupResult.status !== 0) {
    return { setupResult, exeResult: null, manifest: null };
  }

  const manifestLine = (setupResult.stdout ?? "")
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  const manifest = manifestLine ? JSON.parse(manifestLine) : null;
  if (!manifest) {
    return { setupResult, exeResult: null, manifest: null };
  }

  const exeResult = runSandboxCommand({
    workspaceDir,
    codexHomeDir,
    mode,
    privateDesktop,
    commandArgs: [fixtureExe, "cmd"],
    timeout: COMMAND_TIMEOUT_MS
  });
  return { setupResult, exeResult, manifest };
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
    const { rootDir, workspaceDir, outsideDir, codexHomeDir, fixtureBinDir } = createLayout();
    const fixtureExe = prepareFixtureExe(fixtureBinDir);
    writeSandboxConfig({
      codexHomeDir,
      mode,
      privateDesktop,
      tempRoot: os.tmpdir(),
      fixtureBinDir
    });

    t.after(() => {
      removeIfExists(rootDir);
      removeIfExists(outsideDir);
      removeIfExists(fixtureExe);
    });

    const service = new WindowsSandboxSetupService({
      codexHomeDir,
      workspaceDir,
      platform: "win32",
      setupTimeoutMs: SETUP_TIMEOUT_MS,
      logger: { info() {}, error() {} }
    });

    const setupResult = await service.runSetup(mode);
    assert.equal(
      setupResult.ok,
      true,
      setupResult.ok ? "" : `${setupResult.error.code}: ${setupResult.error.message}`
    );

    await t.test("workspace write is allowed", () => {
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

    await t.test("outside workspace write is blocked", () => {
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

    await t.test("named pipe creation is blocked", () => {
      const result = runSandboxCommand({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        commandArgs: ["cmd", "/c", "echo hi > \\\\.\\pipe\\lilto_windows_sandbox_live_test"]
      });

      assertFailed(result, "named pipe creation");
    });

    await t.test("raw device access is blocked", () => {
      const result = runSandboxCommand({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        commandArgs: ["cmd", "/c", "type \\.\PhysicalDrive0"]
      });

      assertFailed(result, "raw device access");
    });

    await t.test("Agent Skill operation can use Temp, Web, and allowed fixture exe", () => {
      const outsideFile = path.join(outsideDir, "skill-blocked.txt");
      removeIfExists(outsideFile);
      const { setupResult, exeResult, manifest } = runSandboxSkillOperation({
        workspaceDir,
        codexHomeDir,
        mode,
        privateDesktop,
        fixtureExe,
        outsideFile
      });

      assertSucceeded(setupResult, "sandbox skill setup operation");
      assert.ok(manifest, `manifest JSON should be printed. stdout=${setupResult.stdout ?? ""}`);
      assert.equal(manifest.ok, true);
      assert.equal(manifest.web.ok, true);
      assert.equal(typeof manifest.web.status, "number");
      assert.match(manifest.web.digest, /^[a-f0-9]{64}$/);
      assert.ok(exeResult, "fixture exe should run after manifest setup");
      assertSucceeded(exeResult, "sandbox fixture exe");
      assert.match(exeResult.stdout, /cmd/i);
      fs.writeFileSync(
        manifest.exeResultPath,
        JSON.stringify({
          ok: true,
          fixtureExe,
          status: exeResult.status,
          stdout: exeResult.stdout ?? "",
          stderr: exeResult.stderr ?? ""
        }, null, 2),
        "utf8"
      );
      assert.equal(manifest.outsideWrite.attempted, true);
      assert.equal(manifest.outsideWrite.blocked, true);
      assert.equal(fs.existsSync(outsideFile), false);
      assert.equal(fs.existsSync(manifest.manifestPath), true);
      assert.equal(fs.existsSync(manifest.webResultPath), true);
      assert.equal(fs.existsSync(manifest.exeResultPath), true);
    });
  }
);
