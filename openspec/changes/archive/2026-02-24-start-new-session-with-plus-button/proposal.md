## Why

現在の UI にはプラスボタンが表示されているが、新しいセッション開始の動作が定義されておらず、会話をリセットしたいユーザーが確実に再開できない。ヘッダー操作だけで新規セッションに切り替えられる体験を明確化し、誤操作なく会話を始め直せるようにする。

## What Changes

- ヘッダーのプラスボタンを「新しいセッション開始」アクションとして正式化する。
- プラスボタン押下時に現在の会話履歴と実行中表示を初期化し、入力可能な新規セッション状態へ遷移する。
- 新規セッション開始時に進行中送信がある場合の挙動（安全に中断/無効化）を定義する。
- 既存の送信・設定導線を壊さずに、トップバーからのセッション再開導線を追加する。

## Capabilities

### New Capabilities
- なし

### Modified Capabilities
- `lit-chat-app`: トップバーの新規セッション操作と、`lilt-app` の会話状態初期化要件を追加する。

## Impact

- Affected specs: `openspec/specs/lit-chat-app/spec.md`（要件追加/更新）
- Affected code: `src/renderer/components/top-bar.ts`, `src/renderer/app.ts`, 必要に応じて関連テスト/E2E
- UI/UX: 画面上部のプラスボタンに明確な機能を付与し、会話再開導線を改善
