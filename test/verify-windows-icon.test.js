const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { NtExecutable, NtExecutableResource, Resource, Data } = require("resedit");
const { verifyWindowsIcon } = require("../scripts/verify-windows-icon");

test("packaged EXE must contain every Lilt-o icon size, not a missing or different icon", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-icon-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const exePath = path.join(directory, "Lilt-o.exe");
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");
  const executable = NtExecutable.createEmpty(false, false);
  fs.writeFileSync(exePath, Buffer.from(executable.generate()));
  assert.throws(() => verifyWindowsIcon(exePath, iconPath), /No application icon/);

  const resource = NtExecutableResource.from(executable);
  const icons = Data.IconFile.from(fs.readFileSync(iconPath)).icons.map((icon) => icon.data);
  Resource.IconGroupEntry.replaceIconsForResource(resource.entries, 1, 1033, icons);
  resource.outputResource(executable);
  fs.writeFileSync(exePath, Buffer.from(executable.generate()));
  assert.doesNotThrow(() => verifyWindowsIcon(exePath, iconPath));

  const firstIcon = resource.entries.find((entry) => entry.type === 3);
  new Uint8Array(firstIcon.bin)[firstIcon.bin.byteLength - 1] ^= 1;
  resource.outputResource(executable);
  fs.writeFileSync(exePath, Buffer.from(executable.generate()));
  assert.throws(() => verifyWindowsIcon(exePath, iconPath), /does not match/);
});
