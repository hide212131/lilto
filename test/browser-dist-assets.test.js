const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { collectBrowserMcpAssets } = require("../scripts/browser-mcp-assets");

const root = path.resolve(__dirname, "..");

test("every file the MCP child loads is listed in asarUnpack, and it needs only Node built-ins", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const { files, external } = collectBrowserMcpAssets(root);
  for (const file of files) assert.ok(pkg.build.asarUnpack.includes(file), `${file} must be in build.asarUnpack`);
  assert.ok(external.every((spec) => spec.startsWith("node:")), `non-builtin requires: ${external}`);
  assert.ok(files.includes("dist/main/browser-mcp-server.js"));
});

test("MCP server runs from an isolated unpacked layout (no node_modules, no repo paths)", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-unpacked-"));
  const unpacked = path.join(sandbox, "resources", "app.asar.unpacked");
  for (const file of collectBrowserMcpAssets(root).files) {
    const target = path.join(unpacked, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const entry = path.join(unpacked, "dist", "main", "browser-mcp-server.js");
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" }
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  // cwd is the sandbox, not the repo; NODE_PATH is cleared so nothing can resolve from the repo.
  const result = spawnSync(process.execPath, [entry], { input, cwd: sandbox, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].result.serverInfo.name, "lilto-browser");
  assert.equal(lines[1].result.tools.length, 16);
  assert.equal(result.stdout.includes(root), false, "no development-machine path leaks into output");
});
