const test = require("node:test");
const assert = require("node:assert/strict");

const { validatePrompt } = require("../dist/main/ipc-contract.js");

test("prompt バリデーション", () => {
  assert.equal(validatePrompt({ text: "hello" }).ok, true);
  assert.equal(validatePrompt({ text: "   " }).ok, false);
  assert.equal(validatePrompt(null).ok, false);
});
