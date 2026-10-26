const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { version } = require("../package.json");

test("release verifier accepts complete Windows and macOS assets and rejects mismatch", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-release-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const installerName = `Lilt-o-${version}-win-x64.exe`;
  const blockmapName = `${installerName}.blockmap`;
  const installer = Buffer.from("windows installer fixture");
  const blockmap = Buffer.from("blockmap fixture");
  fs.writeFileSync(path.join(directory, installerName), installer);
  fs.writeFileSync(path.join(directory, blockmapName), blockmap);
  fs.writeFileSync(path.join(directory, `Lilt-o-${version}-mac-arm64.dmg`), "mac installer");
  fs.writeFileSync(path.join(directory, `Lilt-o-${version}-mac-arm64.dmg.blockmap`), "mac blockmap");
  fs.writeFileSync(path.join(directory, "latest.yml"), [
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${crypto.createHash("sha512").update(installer).digest("base64")}`,
    `    size: ${installer.length}`
  ].join("\n"));

  const script = path.join(__dirname, "..", "scripts", "verify-release-artifacts.js");
  const valid = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);

  const manifestPath = path.join(directory, "latest.yml");
  const validManifest = fs.readFileSync(manifestPath, "utf8");
  fs.writeFileSync(manifestPath, `${validManifest}\n    blockMapUrl: ../outside.blockmap`);
  const invalidBlockmapPath = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.notEqual(invalidBlockmapPath.status, 0);
  assert.match(invalidBlockmapPath.stderr, /blockmap URL must resolve/);

  fs.writeFileSync(manifestPath, validManifest);
  fs.appendFileSync(path.join(directory, installerName), "tampered");
  const invalid = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /size does not match/);
});
