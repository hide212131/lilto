## 1. 仕様
- [x] 1.1 OpenSpec change を作成し `openspec validate separate-session-archive-and-delete --strict` を通す。

## 2. Main
- [x] 2.1 `ConversationHistoryService.deleteConversation`（`thread/delete`、finally で close）。
- [x] 2.2 `AgentRuntime` に `isConversationRunning` と `forgetConversation` を追加する（これ以外は変更しない）。
- [x] 2.3 `conversations:delete` を追加し、archive と共通の検証（payload・heartbeat・処理中 Set・実行中・スケジュール参照・確認失敗）とエラーコード変換を実装する。成功時に対象キャッシュを破棄する。
- [x] 2.4 `ipc.ts` から scheduler を会話 IPC へ配線し、preload・renderer 型へ `deleteConversation` を追加する。IPC 契約テストを 49 チャネルへ更新する。

## 3. Renderer
- [x] 3.1 メニューを 3 項目（button、削除のみ危険色）にし、heartbeat には表示しない。
- [x] 3.2 失敗表示領域（role="alert"、閉じる、自動消去なし）。
- [x] 3.3 共通操作入口（処理中 Set、除去済み ID、確認、IPC、共通後処理）。
- [x] 3.4 composer に対象下書きの破棄を追加し、選択解除後に呼ぶ。

## 4. 検証
- [x] 4.1 unit テスト（履歴サービス・IPC・renderer 操作）。
- [x] 4.2 tsc／build／unit 全件。
- [x] 4.3 `/live-ui-manual-verification` で実 Electron の GUI 確認。
- [x] 4.4 最後に `npm run e2e:electron` を成功させ `test/artifacts/electron-e2e.png` を確認する。
