const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// U7: renderer pin wiring. Following the existing contract-test convention in
// new-session-ui-contract.test.js (string/structure checks against the real source,
// not a duplicated copy of the private method), this does not re-implement
// _onSetSessionPinned: the behavioural half of the contract (grouping/compare/
// classification) is already covered functionally in session-pins.test.js against
// the same shared module app.ts and chat-history.ts both import.

test("Session と window.lilto が isPinned / setConversationPinned を公開する", () => {
  const types = fs.readFileSync("src/renderer/types.ts", "utf8");
  assert.match(types, /isPinned\?: boolean;/);
  assert.match(types, /setConversationPinned: \(conversationId: string, isPinned: boolean\) => Promise</);
});

test("lilt-app は isPinned を既存 hasUnread と同じ合成規則で正規化・保持する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /isPinned: session\.isPinned === true,/);
  assert.match(content, /hasUnread: existing\?\.hasUnread \?\? normalized\.hasUnread,\s*isPinned: existing\?\.isPinned \?\? normalized\.isPinned,/);
  assert.match(content, /hasUnread: localSession\.hasUnread,\s*isPinned: localSession\.isPinned,/);
});

test("lilt-app はピン pending 集合を持ち、同一 ID の連打・Heartbeat を拒否する", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /private _pinningSessionIds: string\[\] = \[\];/);
  assert.match(content, /private async _onSetSessionPinned\(\{ sessionId, isPinned \}: \{ sessionId: string; isPinned: boolean \}\) \{\s*if \(this\._pinningSessionIds\.includes\(sessionId\) \|\| isHeartbeatAssistantSessionId\(sessionId\)\) return;/);
});

test("lilt-app の成功応答は対象セッションだけを id で更新し、他フィールドは変更しない", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  assert.match(content, /this\.sessions = this\.sessions\.map\(\(s\) => s\.id === sessionId \? \{ \.\.\.s, isPinned: result\.isPinned \} : s\);/);
});

test("lilt-app の失敗応答は sessions を書き換えず、理由を actionError に残す（旧状態・位置を保つ）", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  const match = content.match(/private async _onSetSessionPinned[\s\S]*?\n  \}/);
  assert.ok(match, "_onSetSessionPinned method not found");
  const body = match[0];
  assert.match(body, /if \(!result\.ok\) \{\s*this\._sessionActionError = /);
  assert.match(body, /return;\s*\}/);
  // The `this.sessions = ...map` reassignment must appear after the failure-path return.
  const returnIndex = body.indexOf("return;");
  const mapIndex = body.indexOf("this.sessions = this.sessions.map(");
  assert.ok(returnIndex > 0 && mapIndex > returnIndex, "sessions must not be reassigned on failure");
});

test("lilt-app はピン操作の pending を finally で解除する（失敗時も busy が残らない）", () => {
  const content = fs.readFileSync("src/renderer/app.ts", "utf8");
  const match = content.match(/private async _onSetSessionPinned[\s\S]*?\n  \}/);
  assert.match(match[0], /\} finally \{\s*this\._pinningSessionIds = this\._pinningSessionIds\.filter\(\(id\) => id !== sessionId\);\s*\}/);
});

test("chat-history は pinningSessionIds / busySessionIds を pin-btn の disabled に反映する", () => {
  const content = fs.readFileSync("src/renderer/components/chat-history.ts", "utf8");
  assert.match(content, /pinningSessionIds: string\[\] = \[\];/);
  assert.match(content, /const disabled = this\.pinningSessionIds\.includes\(session\.id\) \|\| this\.busySessionIds\.includes\(session\.id\);/);
});

test("set-session-pinned イベントは希望状態（現在の反転）を detail で運ぶ", () => {
  const content = fs.readFileSync("src/renderer/components/chat-history.ts", "utf8");
  assert.match(content, /new CustomEvent\("set-session-pinned", \{\s*detail: \{ sessionId: session\.id, isPinned: !isSessionPinned\(session\) \},\s*bubbles: true,\s*composed: true/);
});
