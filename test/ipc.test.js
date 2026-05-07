const test = require("node:test");
const assert = require("node:assert/strict");

const { validatePrompt } = require("../dist/main/ipc-contract.js");
const { normalizePluginMentionsForPrompt } = require("../dist/main/plugin-mentions.js");

test("prompt バリデーション", () => {
  assert.equal(validatePrompt({ text: "hello" }).ok, true);
  assert.equal(validatePrompt({ text: "hello", silent: true }).ok, true);
  assert.equal(validatePrompt({ text: "   " }).ok, false);
  assert.equal(validatePrompt({ text: "hello", silent: "yes" }).ok, false);
  assert.equal(validatePrompt(null).ok, false);
});

test("plain plugin mention を structured plugin link へ正規化する", () => {
  const result = normalizePluginMentionsForPrompt(
    "@gmail で接続状態を確認して。",
    [{ id: "gmail@openai-curated", name: "gmail" }]
  );

  assert.equal(result, "[@gmail](plugin://gmail@openai-curated) で接続状態を確認して。");
});

test("email や既存 markdown plugin link は壊さない", () => {
  const result = normalizePluginMentionsForPrompt(
    "test@gmail.com に送って。既存: [@gmail](plugin://gmail@openai-curated)",
    [{ id: "gmail@openai-curated", name: "gmail" }]
  );

  assert.equal(result, "test@gmail.com に送って。既存: [@gmail](plugin://gmail@openai-curated)");
});
