const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

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

test("WindowsSandboxSetupService は canceled を専用エラーへ変換する", async () => {
  const service = new WindowsSandboxSetupService({
    codexHomeDir: "C:/tmp/codex-home",
    workspaceDir: "C:/tmp/workspace",
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