const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload は plugin 管理 API を公開する", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /listPlugins: async \(payload\?: \{ forceRemoteSync\?: boolean \}\)/);
  assert.match(content, /ipcRenderer\.invoke\("plugins:list", payload \?\? \{\}\)/);
  assert.match(content, /readPlugin: async \(payload: \{ marketplacePath: string; pluginName: string \}\)/);
  assert.match(content, /ipcRenderer\.invoke\("plugins:read", payload\)/);
  assert.match(content, /installPlugin: async \(payload: \{ marketplacePath: string; pluginName: string; sourceKind: "official-curated" \| "bundled" \}\)/);
  assert.match(content, /ipcRenderer\.invoke\("plugins:install", payload\)/);
  assert.match(content, /uninstallPlugin: async \(payload: \{ pluginId: string; sourceKind\?: "official-curated" \| "bundled" \}\)/);
  assert.match(content, /ipcRenderer\.invoke\("plugins:uninstall", payload\)/);
});

test("settings-modal は Plugins タブから plugin marketplace と installed state を管理できる", () => {
  const content = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  assert.match(content, />Plugins<\/div>/);
  assert.match(content, /private _renderPlugins\(\)/);
  assert.match(content, /Codex plugin の marketplace 一覧/);
  assert.match(content, /window\.lilto\.listPlugins\(\{ forceRemoteSync \}\)/);
  assert.match(content, /window\.lilto\.readPlugin\(\{/);
  assert.match(content, /window\.lilto\.openExternalUrl\(/);
  assert.match(content, /window\.lilto\.installPlugin\(\{/);
  assert.match(content, /window\.lilto\.uninstallPlugin\(\{/);
  assert.match(content, /接続が必要/);
  assert.match(content, /設定を開く/);
  assert.match(content, /_connectPlugin/);
  assert.match(content, /Marketplace plugins/);
  assert.match(content, /Installed plugins/);
  assert.match(content, /this\._activeTab === "plugins"/);
});

test("main ipc は plugin list/install/uninstall handler を公開し runtime cache を refresh する", () => {
  const content = fs.readFileSync("src/main/ipc.ts", "utf8");
  assert.match(content, /ipcMain\.handle\("plugins:list"/);
  assert.match(content, /ipcMain\.handle\("plugins:read"/);
  assert.match(content, /await pluginService\.readPlugin\(/);
  assert.match(content, /await pluginService\.listPlugins\(/);
  assert.match(content, /ipcMain\.handle\("plugins:install"/);
  assert.match(content, /await pluginService\.installPlugin\(/);
  assert.match(content, /ipcMain\.handle\("plugins:uninstall"/);
  assert.match(content, /await pluginService\.uninstallPlugin\(/);
  assert.match(content, /agentRuntime\.refreshPlugins\(\)/);
  assert.match(content, /normalizePromptPluginMentions/);
  assert.match(content, /normalizePluginMentionsForPrompt/);
});