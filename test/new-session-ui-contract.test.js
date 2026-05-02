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

test("lilt-app が user 送信前と retry 巻き戻し直後に session snapshot を保存する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /this\._addMessage\("user", text\);\s*this\._saveCurrentSession\(\);\s*await this\._doSend\(text\);/s);
  assert.match(content, /this\.messages = this\.messages\.slice\(0, idx \+ 1\);\s*this\._saveCurrentSession\(\);\s*await this\._doSend\(text\);/s);
});

test("lilt-app がドラッグでサイドバー幅を変更して保存できる", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /SIDEBAR_WIDTH_STORAGE_KEY/);
  assert.match(content, /sidebarWidth = DEFAULT_SIDEBAR_WIDTH/);
  assert.match(content, /class="sidebar-resizer"/);
  assert.match(content, /@pointerdown=\$\{this\._onSidebarResizeStart\}/);
  assert.match(content, /window\.addEventListener\("pointermove", this\._onSidebarResize\)/);
  assert.match(content, /this\._saveSidebarWidth\(\)/);
});
