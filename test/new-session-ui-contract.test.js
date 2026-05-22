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
  assert.match(content, /_pendingAssistantMessageId = null/);
  assert.match(content, /_pendingConversationId = null/);
  assert.match(content, /_statusLines = \[\]/);
});

test("lilt-app は送信開始時の session に assistant 応答を書き戻す", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /const conversationId = this\._currentSessionId;/);
  assert.match(content, /_appendMessageToSession\(conversationId, \{/);
  assert.match(content, /_updateSessionMessage\(conversationId, pendingMessageId, \{/);
  assert.match(content, /_removeSessionMessage\(conversationId, pendingMessageId\)/);
});

test("lilt-app が user 送信前と retry 巻き戻し直後に session snapshot を保存する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /this\._addMessage\("user", text\);/);
  assert.match(content, /const conversationId = await this\._ensureConversation\(title\);/);
  assert.match(content, /this\._saveCurrentSession\(\);\s*await this\._doSend\(text\);/s);
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

test("lilt-app が通知クリックで対象セッションを開く", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /window\.lilto\.onOpenConversation\(\(conversationId\) => \{/);
  assert.match(content, /void this\._openConversation\(conversationId\);/);
  assert.match(content, /private async _openConversation\(conversationId: string\)/);
  assert.match(content, /entry\.backendSessionId === conversationId/);
  assert.match(content, /const nextSession = this\._markSessionRead\(targetSessionId\)/);
  assert.match(content, /this\._currentSessionId = nextSession\.id/);
});

test("lilt-app が App Server 会話一覧を正規化して updatedAt 降順で保持する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /private _normalizeSession\(session: StoredSession\): Session/);
  assert.match(content, /const result = await window\.lilto\.listConversations\(\);/);
  assert.match(content, /const backendSessions = result\.conversations\.map\(\(session\) => \{/);
  assert.match(content, /if \(right\.updatedAt !== left\.updatedAt\)/);
  assert.doesNotMatch(content, /localStorage\.setItem\(SESSIONS_STORAGE_KEY/);
});

test("lilt-app が非表示 session の assistant 系更新を unread にする", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /private _shouldMarkSessionUnread\(sessionId: string, role: Message\["role"\]\): boolean/);
  assert.match(content, /role === "assistant" \|\| role === "system" \|\| role === "error"/);
  assert.match(content, /private _markSessionRead\(sessionId: string\): Session \| null/);
  assert.match(content, /const nextSession = this\._markSessionRead\(targetSessionId\)/);
});

test("chat-history が active 以外の unread dot と updatedAt 表示を持つ", () => {
  const content = fs.readFileSync("src/renderer/components/chat-history.ts", "utf8");
  assert.match(content, /const date = new Date\(session\.updatedAt\);/);
  assert.match(content, /session\.hasUnread && !isActive && !isEditing/);
  assert.match(content, /class="unread-dot"/);
});
