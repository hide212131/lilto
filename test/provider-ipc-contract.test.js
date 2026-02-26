const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload は providers:getSettings / providers:saveSettings / auth:startClaudeOauth を公開する", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /getProviderSettings:\s*async \(\) => ipcRenderer\.invoke\("providers:getSettings"\)/);
  assert.match(content, /saveProviderSettings:\s*async \(settings: unknown\) => ipcRenderer\.invoke\("providers:saveSettings", settings\)/);
  assert.match(content, /startClaudeOauth:\s*async \(\) => ipcRenderer\.invoke\("auth:startClaudeOauth"\)/);
});

test("ipc は auth:startClaudeOauth 実行時に provider settings の oauthProvider を利用する", () => {
  const content = fs.readFileSync("src/main/ipc.ts", "utf8");
  assert.match(content, /const oauthProvider = providerSettingsService\.getState\(\)\.oauthProvider/);
  assert.match(content, /authService\.startOAuth\(oauthProvider\)/);
});
