const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveAppRoot,
  resolvePackagedCodexBinary,
  resolveNativeHelperPath,
  resolvePreloadPath,
  resolveRendererIndexPath
} = require("../dist/main/app-paths.js");

test("resolvePreloadPath and resolveRendererIndexPath use the packaged app root", () => {
  const appRoot = path.join(os.tmpdir(), "Lilt-o.app", "Contents", "Resources", "app.asar");
  const resolvedAppRoot = path.resolve(appRoot);
  assert.equal(resolveAppRoot({ appRoot }), resolvedAppRoot);
  assert.equal(resolvePreloadPath({ appRoot }), path.join(resolvedAppRoot, "dist", "preload.js"));
  assert.equal(resolveRendererIndexPath({ appRoot }), path.join(resolvedAppRoot, "dist", "renderer", "index.html"));
});

test("resolveNativeHelperPath prefers development output when it exists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-app-paths-"));
  const candidate = path.join(tempRoot, "native", "scheduler-daemon", "bin", "scheduler-daemon");
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(candidate, "binary");

  const resolved = resolveNativeHelperPath({
    projectRoot: tempRoot,
    resourcesPath: path.join(tempRoot, "resources"),
    packagedRelativePath: "bin/scheduler-daemon",
    developmentCandidates: ["native/scheduler-daemon/bin/scheduler-daemon"]
  });

  assert.equal(resolved, candidate);
});

test("resolveNativeHelperPath prefers packaged resources for packaged builds", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-app-paths-"));
  const packaged = path.join(tempRoot, "resources", "bin", "speech-transcriber.exe");
  fs.mkdirSync(path.dirname(packaged), { recursive: true });
  fs.writeFileSync(packaged, "binary");

  const resolved = resolveNativeHelperPath({
    projectRoot: tempRoot,
    resourcesPath: path.join(tempRoot, "resources"),
    isPackaged: true,
    packagedRelativePath: "bin/speech-transcriber.exe",
    developmentCandidates: ["native/speech-transcriber/bin/speech-transcriber.exe"]
  });

  assert.equal(resolved, packaged);
});

test("resolvePackagedCodexBinary returns unpacked codex path for packaged apps", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-app-paths-"));
  const appRoot = path.join(tempRoot, "Lilt-o.app", "Contents", "Resources", "app.asar");
  const binary = path.join(
    tempRoot,
    "Lilt-o.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-darwin-arm64",
    "vendor",
    "aarch64-apple-darwin",
    "codex",
    "codex"
  );
  const rgDir = path.join(path.dirname(path.dirname(binary)), "path");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, "binary");
  fs.mkdirSync(rgDir, { recursive: true });

  const resolved = resolvePackagedCodexBinary({
    appRoot,
    platform: "darwin",
    arch: "arm64"
  });

  assert.deepEqual(resolved, {
    command: binary,
    extraPath: rgDir
  });
});
