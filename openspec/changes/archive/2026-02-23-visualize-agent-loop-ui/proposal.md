## Why

現在の UI は最終応答またはエラーのみが見え、実行中にエージェントが何をしているか（思考生成中か、どのツールを実行中か）が分からない。`pi-tui` / `pi-web-ui` で表現されているループ進行の可視化を取り込み、長時間処理中でもユーザーが進捗を判断できる状態にする必要がある。

## What Changes

- `pi-web-ui` の `Agent` 連携パターンを参照し、`pi-agent-core` のループイベント（例: `tool_execution_start/end`）を Main->Renderer へ中継する。
- Renderer に「実行中ループ表示」を追加し、進行中ツール、思考中、完了/失敗を会話表示内で可視化する。
- 既存の最終結果中心 UI を拡張し、イベント駆動で状態遷移する実装とテストを追加する。

## Capabilities

### New Capabilities
- `agent-loop-visualization`: 実行中エージェントループのイベントを UI で時系列に可視化し、進行中/完了/失敗をユーザーが追跡できるようにする。

### Modified Capabilities
- `pi-main-agent-runtime`: Main プロセスのエージェント実行経路にループイベント中継要件を追加する。
- `lit-chat-app`: チャット UI に実行中ループ表示とツール実行状態の描画要件を追加する。

## Impact

- Main: `pi-agent-core` 実行ラッパー、イベント購読、IPC 送信ペイロード拡張。
- Preload/IPC 契約: ループイベント通知チャネルと型定義の追加。
- Renderer: Lit コンポーネント（メッセージ一覧/ステータス表示）の拡張、イベント状態管理。
- テスト: Main 単体テスト、Renderer 単体テスト、Electron E2E（実行中表示の検証）更新。
