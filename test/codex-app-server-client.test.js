const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCodexAppServerEnvironmentForTest } = require("../dist/main/codex-app-server-client.js");

test("codex app-server env keeps HOME and USERPROFILE while setting CODEX_HOME", { concurrency: false }, () => {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = "/users/real-home";
  process.env.USERPROFILE = "C:\\Users\\Real";
  try {
    const env = buildCodexAppServerEnvironmentForTest({
      codexHomeDir: "C:\\Users\\hide\\AppData\\Local\\Lilt-o\\codex"
    });

    assert.equal(env.HOME, "/users/real-home");
    assert.equal(env.USERPROFILE, "C:\\Users\\Real");
    assert.equal(env.CODEX_HOME, "C:\\Users\\hide\\AppData\\Local\\Lilt-o\\codex");
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  }
});
