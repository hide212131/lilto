const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");

const root = path.resolve(process.argv[2] || "artifacts");
const version = require("../package.json").version;
const fail = (message) => { throw new Error(message); };
const files = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
const expectedInstaller = `Lilt-o-${version}-win-x64.exe`;
const expectedBlockmap = `${expectedInstaller}.blockmap`;
for (const name of [expectedInstaller, expectedBlockmap, "latest.yml"]) {
  if (!files.includes(name)) fail(`Release artifact is missing: ${name}`);
}
if (!files.some((name) => name.startsWith(`Lilt-o-${version}-mac-`) && name.endsWith(".dmg"))) {
  fail(`macOS DMG for ${version} is missing`);
}
if (!files.some((name) => name.startsWith(`Lilt-o-${version}-mac-`) && name.endsWith(".dmg.blockmap"))) {
  fail(`macOS DMG blockmap for ${version} is missing`);
}

const manifest = yaml.load(fs.readFileSync(path.join(root, "latest.yml"), "utf8"));
if (manifest?.version !== version) fail(`latest.yml version must be ${version}`);
const entry = Array.isArray(manifest.files) ? manifest.files[0] : manifest;
if (entry?.url !== expectedInstaller) fail(`latest.yml must point to ${expectedInstaller}`);
const blockMapUrl = entry?.blockMapUrl || expectedBlockmap;
if (blockMapUrl !== expectedBlockmap) fail(`latest.yml blockmap URL must resolve to ${expectedBlockmap}`);
if (path.isAbsolute(entry.url) || entry.url.split(/[\\/]/).includes("..")) fail("latest.yml installer path is invalid");
if (path.isAbsolute(blockMapUrl) || blockMapUrl.split(/[\\/]/).includes("..")) fail("latest.yml blockmap path is invalid");
const bytes = fs.readFileSync(path.join(root, expectedInstaller));
if (entry.size !== bytes.length) fail("latest.yml installer size does not match");
if (entry.sha512 !== crypto.createHash("sha512").update(bytes).digest("base64")) fail("latest.yml installer SHA-512 does not match");
if (typeof entry.blockMapSize !== "number" || entry.blockMapSize !== fs.statSync(path.join(root, blockMapUrl)).size) {
  fail("latest.yml blockmap size does not match");
}
console.log(`Verified ${files.length} release assets for ${version}`);
