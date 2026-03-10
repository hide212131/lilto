const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  defaultManifest,
  normalizeVersion,
  parseArgs,
  releaseDir,
  rootDir,
  saveManifest,
  loadManifest,
  upsertArtifact
} = require("../scripts/release-common");

test("normalizeVersion: v prefix を除去する", () => {
  assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeVersion("1.2.3"), "1.2.3");
});

test("parseArgs: --flag value と boolean を解釈する", () => {
  const args = parseArgs(["--version", "1.2.3", "--dry-run", "--platform=mac"]);
  assert.equal(args.version, "1.2.3");
  assert.equal(args["dry-run"], true);
  assert.equal(args.platform, "mac");
});

test("manifest roundtrip: artifacts を保存できる", () => {
  const version = "9.9.9-test";
  const dir = releaseDir(version);
  fs.rmSync(dir, { recursive: true, force: true });
  const manifest = defaultManifest({ version, repository: "owner/repo", gitlabProject: "group/project" });
  upsertArtifact(manifest, {
    platform: "macos",
    fileName: "Lilt-o-9.9.9-test-arm64.zip",
    path: "release/9.9.9-test/dist/Lilt-o-9.9.9-test-arm64.zip",
    size: 123,
    generatedAt: new Date().toISOString()
  });
  saveManifest(manifest);
  const loaded = loadManifest(version);
  assert.equal(loaded.release.version, version);
  assert.equal(loaded.artifacts.length, 1);
  assert.equal(loaded.publishTargets.github.repository, "owner/repo");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("defaultManifest: notes file は release 配下を指す", () => {
  const manifest = defaultManifest({ version: "1.0.0" });
  assert.equal(manifest.release.notesFile, path.join("release", "1.0.0", "RELEASE_NOTES.md"));
  assert.equal(path.dirname(path.join(rootDir, manifest.release.notesFile)), path.join(rootDir, "release", "1.0.0"));
});
