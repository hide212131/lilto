const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload は providers:getSettings / providers:saveSettings / auth:startClaudeOauth を公開する", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /getProviderSettings:\s*async \(\) => ipcRenderer\.invoke\("providers:getSettings"\)/);
  assert.match(content, /saveProviderSettings:\s*async \(settings: unknown\) => ipcRenderer\.invoke\("providers:saveSettings", settings\)/);
  assert.match(content, /setupWindowsSandbox:\s*async \(payload: unknown\) => ipcRenderer\.invoke\("windowsSandbox:setup", payload\)/);
  assert.match(content, /startClaudeOauth:\s*async \(\) => ipcRenderer\.invoke\("auth:startClaudeOauth"\)/);
  assert.match(content, /listModels:\s*async \(payload: unknown\) => ipcRenderer\.invoke\("models:list", payload\)/);
});

test("ipc は auth:startClaudeOauth 実行時に openai-codex 固定で認証を開始する", () => {
  const content = fs.readFileSync("src/main/ipc.ts", "utf8");
  assert.match(content, /authService\.startOAuth\("openai-codex"\)/);
  assert.match(content, /ipcMain\.handle\("models:list"/);
  assert.match(content, /ipcMain\.handle\("windowsSandbox:setup"/);
  assert.match(content, /agentRuntime\.refreshProviderSettings\(\);/);
});
