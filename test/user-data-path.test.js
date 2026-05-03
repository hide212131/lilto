const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  configureAppUserDataPath,
  resolveWindowsLocalAppDataDir,
  resolveWindowsUserDataDir
} = require("../dist/main/user-data-path.js");

test("resolveWindowsUserDataDir uses AppData Local with uppercase Lilt-o", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\hide\\AppData\\Local",
    APPDATA: "C:\\Users\\hide\\AppData\\Roaming",
    USERPROFILE: "C:\\Users\\hide"
  };

  assert.equal(resolveWindowsLocalAppDataDir(env), "C:\\Users\\hide\\AppData\\Local");
  assert.equal(resolveWindowsUserDataDir(env), path.win32.join("C:\\Users\\hide\\AppData\\Local", "Lilt-o"));
});

test("resolveWindowsUserDataDir falls back to USERPROFILE AppData Local", () => {
  const env = {
    USERPROFILE: "C:\\Users\\hide"
  };

  assert.equal(resolveWindowsUserDataDir(env), path.win32.join("C:\\Users\\hide", "AppData", "Local", "Lilt-o"));
});

test("configureAppUserDataPath sets Local Lilt-o and copies legacy Roaming data", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-user-data-"));
  const localAppData = path.join(root, "Local");
  const roamingAppData = path.join(root, "Roaming");
  const legacyDir = path.join(roamingAppData, "lilt-o");
  const legacyFile = path.join(legacyDir, "provider-settings.json");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(legacyFile, "{}");

  const calls = [];
  const app = {
    setPath(name, value) {
      calls.push({ name, value });
    }
  };

  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    configureAppUserDataPath(app, {
      LOCALAPPDATA: localAppData,
      APPDATA: roamingAppData,
      USERPROFILE: root
    });
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }

  const expectedUserDataDir = path.win32.join(localAppData, "Lilt-o");
  assert.deepEqual(calls, [{ name: "userData", value: expectedUserDataDir }]);
  assert.equal(fs.existsSync(path.join(expectedUserDataDir, "provider-settings.json")), true);
});
