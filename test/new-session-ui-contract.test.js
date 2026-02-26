const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("top-bar が new-session と disabled 制御を公開する", () => {
  const content = fs.readFileSync("src/renderer/components/top-bar.ts", "utf8");
  assert.match(content, /newSessionDisabled/);
  assert.match(content, /\?disabled=\$\{this\.newSessionDisabled\}/);
  assert.match(content, /CustomEvent\("new-session"/);
});

test("lilt-app が new-session で会話状態を初期化する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /@new-session=\$\{this\._onStartNewSession\}/);
  assert.match(content, /messages = \[\]/);
  assert.match(content, /loopState = createInitialLoopState\(\)/);
  assert.match(content, /_pendingAssistantIndex = null/);
  assert.match(content, /_statusLines = \[\]/);
});
