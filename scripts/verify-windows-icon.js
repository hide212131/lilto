const fs = require("node:fs");
const { NtExecutable, NtExecutableResource, Resource } = require("resedit");

// Check the packaged EXE itself: installer/window icons can look correct even
// when resource editing was disabled and the EXE still has Electron's icon.
function verifyWindowsIcon(executablePath, iconPath) {
  const executable = NtExecutable.from(fs.readFileSync(executablePath), { ignoreCert: true });
  const { entries } = NtExecutableResource.from(executable);
  const group = Resource.IconGroupEntry.fromEntries(entries)[0];
  if (!group) throw new Error(`No application icon in ${executablePath}`);

  const ico = fs.readFileSync(iconPath);
  const count = ico.readUInt16LE(4);
  if (!count || group.icons.length !== count) {
    throw new Error(`Application icon sizes do not match ${iconPath}`);
  }
  for (let index = 0; index < count; index++) {
    const offset = 6 + index * 16;
    const size = ico.readUInt32LE(offset + 8);
    const start = ico.readUInt32LE(offset + 12);
    const expected = ico.subarray(start, start + size);
    const width = ico[offset] || 256;
    const height = ico[offset + 1] || 256;
    const matches = group.icons.some((icon) => {
      const entry = entries.find((entry) => entry.type === 3 && entry.id === icon.iconID && entry.lang === group.lang);
      return (icon.width || 256) === width && (icon.height || 256) === height && entry && Buffer.from(entry.bin).equals(expected);
    });
    if (!matches) throw new Error(`Application icon ${width}x${height} does not match ${iconPath}`);
  }
}

module.exports = { verifyWindowsIcon };
