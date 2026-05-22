## 1. Main runtime と履歴基盤の移行

- [x] 1.1 `CodexAppServerClient` に初期化通知と逐次 notification 消費を追加し、App Server を stdio JSON-RPC で扱えるようにする
- [x] 1.2 `AgentRuntime` の実行経路を App Server ベース thread/turn 実行へ差し替え、既存 `AgentLoopEvent` へ変換する
- [x] 1.3 `ConversationHistoryService` を追加し、会話一覧取得、詳細取得、会話作成、rename、archive を Main へ集約する

## 2. IPC と Renderer 会話管理の置き換え

- [x] 2.1 `conversations:list/read/create/rename/archive` を Main IPC と preload に公開する
- [x] 2.2 `lilt-app` の起動時 hydrate、会話再開、送信前会話確保を App Server ベースへ移し、会話 `localStorage` 永続化を撤去する
- [x] 2.3 scheduler / heartbeat / 通知クリック復帰が永続会話 ID を使って同じ会話へ戻るように整える

## 3. 仕様整合と検証

- [x] 3.1 Renderer 契約テストと runtime テストを更新し、App Server 実行と履歴 API の互換を確認する
- [x] 3.2 README と lessons を更新し、App Server を会話実行と履歴の正とする方針を明文化する
- [x] 3.3 live UI 検証で prompt 実行成功、履歴サイドバー表示、再起動後の会話再読込を確認する