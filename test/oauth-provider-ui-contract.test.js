const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("settings-modal が ChatGPT login を先に出し、Model 選択 UI を持つ", () => {
  const content = fs.readFileSync("src/renderer/components/settings-modal.ts", "utf8");
  assert.match(content, /import \{ live \} from "lit\/directives\/live\.js"/);
  assert.match(content, /function buildModelOptions\(models: ListedModel\[], selectedId: string, emptyLabel: string\)/);
  assert.match(content, /id="oauth-model"/);
  assert.match(content, /\.value=\$\{live\(this\._oauthModelId \|\| ""\)\}/);
  assert.match(content, /\.value=\$\{live\(this\._customModelId \|\| ""\)\}/);
  assert.match(content, /class="field-select"/);
  assert.match(content, /window\.lilto\.listModels\(\{/);
  assert.match(content, /oauthModelId:\s*this\._oauthModelId\.trim\(\) \|\| "gpt-5\.3-codex"/);
  assert.match(content, /oauthProvider:\s*this\._oauthProvider/);
  assert.match(content, /const saveResult = await window\.lilto\.saveProviderSettings\(\{/);
  assert.match(content, /const result = await window\.lilto\.startClaudeOauth\(\)/);
  assert.match(content, /ChatGPT Authorization/);
  assert.match(content, /ChatGPT auth debug/);
  assert.match(content, /codex auth\.json/);
  assert.match(content, /Model/);
  assert.match(content, /モデル一覧を取得/);
  assert.match(content, /if \(!this\._oauthModelId\.trim\(\) && result\.models\[0\]\)/);
  assert.match(content, /if \(!this\._customModelId\.trim\(\) && result\.models\[0\]\)/);
  assert.match(content, /class="checkbox-card"/);
  assert.doesNotMatch(content, /Runtime/);
  assert.doesNotMatch(content, /id="auth-code"/);
  assert.doesNotMatch(content, /_submitCode/);
});

test("lilt-app が authenticated 状態で送信可否を判定し、不足時に Codex 認証メッセージを出す", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /this\.authState\?\.phase === "authenticated"/);
  assert.match(content, /Codex ChatGPT 認証が必要/);
});
