const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { WindowsSandboxSetupService } = require("../dist/main/windows-sandbox-setup.js");

function createFakeChild(onRequest) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", 0);
    return true;
  };

  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        onRequest(JSON.parse(line), child);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  return child;
}

test("WindowsSandboxSetupService は setupCompleted success を返す", async () => {
  const service = new WindowsSandboxSetupService({
    codexHomeDir: "C:/tmp/codex-home",
    workspaceDir: "C:/tmp/workspace",
    codexCommand: "codex.cmd",
    platform: "win32",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }
      if (request.method === "windowsSandbox/setupStart") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { started: true } })}\n`);
        process.nextTick(() => {
          child.stdout.write(`${JSON.stringify({
            method: "windowsSandbox/setupCompleted",
            params: { mode: "unelevated", success: true, error: null }
          })}\n`);
        });
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.runSetup("unelevated");
  assert.equal(result.ok, true);
  assert.equal(result.mode, "unelevated");
});

test("WindowsSandboxSetupService は elevated success message を返す", async () => {
  const service = new WindowsSandboxSetupService({
    codexHomeDir: "C:/tmp/codex-home",
    workspaceDir: "C:/tmp/workspace",
    codexCommand: "codex.cmd",
    platform: "win32",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }
      if (request.method === "windowsSandbox/setupStart") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { started: true } })}\n`);
        process.nextTick(() => {
          child.stdout.write(`${JSON.stringify({
            method: "windowsSandbox/setupCompleted",
            params: { mode: "elevated", success: true, error: null }
          })}\n`);
        });
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.runSetup("elevated");
  assert.equal(result.ok, true);
  assert.equal(result.mode, "elevated");
  assert.match(result.message, /elevated/);
});

test("WindowsSandboxSetupService は canceled を専用エラーへ変換する", async () => {
  const service = new WindowsSandboxSetupService({
    codexHomeDir: "C:/tmp/codex-home",
    workspaceDir: "C:/tmp/workspace",
    codexCommand: "codex.cmd",
    platform: "win32",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }
      if (request.method === "windowsSandbox/setupStart") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { started: true } })}\n`);
        process.nextTick(() => {
          child.stdout.write(`${JSON.stringify({
            method: "windowsSandbox/setupCompleted",
            params: { mode: "elevated", success: false, error: "setup canceled by user" }
          })}\n`);
        });
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.runSetup("elevated");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "WINDOWS_SANDBOX_SETUP_CANCELED");
});

test("WindowsSandboxSetupService は 1326 のとき setup artifacts を掃除して再試行する", { concurrency: false }, async () => {
  const codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-codex-home-"));
  fs.mkdirSync(path.join(codexHomeDir, ".sandbox"), { recursive: true });
  fs.mkdirSync(path.join(codexHomeDir, ".sandbox-secrets"), { recursive: true });
  fs.writeFileSync(path.join(codexHomeDir, ".sandbox", "setup_marker.json"), "{}");
  fs.writeFileSync(path.join(codexHomeDir, ".sandbox", "setup_error.json"), "{}");
  fs.writeFileSync(path.join(codexHomeDir, ".sandbox-secrets", "sandbox_users.json"), "{}");

  let setupAttempts = 0;
  const service = new WindowsSandboxSetupService({
    codexHomeDir,
    workspaceDir: "C:/tmp/workspace",
    codexCommand: "codex.cmd",
    platform: "win32",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }
      if (request.method === "windowsSandbox/setupStart") {
        setupAttempts += 1;
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { started: true } })}\n`);
        process.nextTick(() => {
          child.stdout.write(`${JSON.stringify({
            method: "windowsSandbox/setupCompleted",
            params: {
              mode: "elevated",
              success: setupAttempts > 1,
              error: setupAttempts > 1 ? null : "CreateProcessWithLogonW failed: 1326"
            }
          })}\n`);
        });
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.runSetup("elevated");
  assert.equal(result.ok, true);
  assert.equal(setupAttempts, 2);
  assert.equal(fs.existsSync(path.join(codexHomeDir, ".sandbox", "setup_marker.json")), false);
  assert.equal(fs.existsSync(path.join(codexHomeDir, ".sandbox", "setup_error.json")), false);
  assert.equal(fs.existsSync(path.join(codexHomeDir, ".sandbox-secrets", "sandbox_users.json")), false);
});
