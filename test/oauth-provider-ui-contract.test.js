const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("settings-modal が OAuth provider 選択 UI を持ち保存 payload に含める", () => {
  const content = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  assert.match(content, /id="oauth-provider"/);
  assert.match(content, /OAUTH_PROVIDER_IDS\.map\(/);
  assert.match(content, /oauthProvider:\s*this\._oauthProvider/);
  assert.match(content, /const saveResult = await window\.lilto\.saveProviderSettings\(\{/);
  assert.match(content, /const result = await window\.lilto\.startClaudeOauth\(\)/);
});

test("lilt-app が選択中 oauthProvider と authState\.provider の一致で送信可否を判定する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /authState\?\.provider === this\.providerSettings\.oauthProvider/);
  assert.match(content, /プロバイダー設定が必要/);
});
