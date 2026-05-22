## Why

Codex SDK 直結の実行経路と renderer の `localStorage` ベース会話管理が分離しており、会話再開・履歴表示・rename/delete・再起動後の整合性を Main 側で一貫して扱えていなかった。Codex App Server を会話実行と履歴永続化の正に揃えることで、現在の UI 体験を維持したまま、会話 ID と履歴責務を一本化する必要がある。

## What Changes

- Main のエージェント実行経路を Codex App Server ベースへ切り替え、thread/turn 実行と逐次通知を既存 `AgentLoopEvent` 契約へ変換する。
- Main に App Server ベースの会話履歴サービスを追加し、会話一覧取得、詳細取得、作成、rename、archive を IPC 越しに公開する。
- Renderer の会話履歴責務を `localStorage` から外し、起動時 hydrate、会話再開、送信前会話確保、rename/archive を Main 経由へ移す。
- 既存 `localStorage` 履歴は移行せず、新規起動直後に履歴 0 件でも正常動作する前提へ変更する。
- scheduler / heartbeat / 通知クリック復帰が永続会話 ID を基準に同じ会話へ戻れるようにする。

## Capabilities

### New Capabilities
- なし

### Modified Capabilities
- `pi-main-agent-runtime`: Main の問い合わせ実行を Codex SDK 直結から Codex App Server 経由へ切り替え、会話履歴管理も Main 側サービスへ集約する。
- `lit-chat-app`: `lilt-app` の会話状態管理を renderer ローカル永続化から App Server hydrate ベースへ変更し、送信前会話確保と会話再開を扱う。
- `renderer-chat-ui`: 履歴サイドバーの一覧、選択、rename、archive、未読管理を App Server 永続会話 ID ベースに切り替える。

## Impact

- 影響コード: `src/main/agent-sdk.ts`, `src/main/codex-app-server-client.ts`, `src/main/conversation-history.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/app.ts`, `src/renderer/types.ts`
- 影響 UI: 会話一覧 hydrate、会話再開、rename/archive、初回送信時の会話作成、再起動後の履歴復元
- 影響テスト: `test/agent-runtime.test.js`, `test/codex-app-server-client.test.js`, `test/new-session-ui-contract.test.js`, `test/scheduler-ui-contract.test.js`
- 影響ドキュメント: `README.md`, OpenSpec delta specs, 実装検証手順