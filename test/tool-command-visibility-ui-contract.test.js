const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("tool command details are hidden by default and controlled by Chat settings", () => {
  const sharedSettings = fs.readFileSync("src/shared/provider-settings.ts", "utf8");
  const settingsService = fs.readFileSync("src/main/provider-settings.ts", "utf8");
  const app = fs.readFileSync("src/renderer/app.ts", "utf8");
  const settingsModal = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  const messageList = fs.readFileSync("src/renderer/components/message-list.ts", "utf8");

  assert.match(sharedSettings, /showToolExecutionDetails: false/);
  assert.match(settingsService, /DEFAULT_CHAT_SETTINGS\.showToolExecutionDetails/);
  assert.match(app, /\.showToolExecutionDetails=\$\{this\.providerSettings\.chatSettings\?\.showToolExecutionDetails \?\? false\}/);
  assert.match(settingsModal, /id="show-tool-execution-details"/);
  assert.match(settingsModal, /showToolExecutionDetails: this\._showToolExecutionDetails/);
  assert.match(messageList, /@property\(\{ type: Boolean \}\) showToolExecutionDetails = false/);
  assert.match(messageList, /this\.showToolExecutionDetails\s*\?\s*html`<pre class="tool-console/);
});
