## Why

ユーザーが「3分後に知らせて」「毎朝9時に通知して」のような依頼をしたとき、現在の lilto は会話中に完結する処理しかできず、将来時刻に再び働きかける手段がありません。Pi の Custom Tool としてスケジューラーを持てば、AI が会話の中で予定を登録・確認・更新・削除し、実行時にチャット画面へ直接通知できるようになります。

## What Changes

- Rust 製の常駐 scheduler daemon を導入し、one-shot と cron ベースの繰り返しタスクを永続化して実行できるようにする。
- Electron Main から scheduler daemon を起動・監視し、IPC とチャット通知経路を統合する。
- Pi の Custom Tool として `cron` ツールを追加し、AI が高水準 API（例: 何秒後に通知、指定日時に通知、毎日 HH:MM に通知）を優先して使いながら、必要時のみ低水準の cron/RFC3339 指定で登録・一覧・変更・削除を実行できるようにする。
- スケジュール登録時に「通知先セッションID」「完了メッセージ」「通知後に AI が続けて行う follow-up 指示」を payload に保持し、タスク発火時に対象チャットへ通知イベントを挿入しつつ、必要なら同一会話で追加処理を起動できるようにする。
- scheduler の状態・エラー・通知イベントを UI で観測できるよう、既存の agent runtime / notification 経路を拡張する。

## Capabilities

### New Capabilities
- `cron-scheduler-tool`: AI が会話からスケジュールを登録・一覧・変更・削除し、期限到来時にチャットへ通知できる capability

### Modified Capabilities
- `pi-main-agent-runtime`: Main プロセスのエージェント実行が scheduler daemon と `cron` custom tool を利用し、発火イベントを対象セッションへ配送できるよう requirement を変更

## Impact

- 追加コード: Rust native daemon、Electron Main の daemon 管理、Pi tool 登録、IPC 契約、Renderer の通知表示
- 影響範囲: `src/main/*`, `src/renderer/*`, preload/shared contract、native build/package 設定、E2E/統合テスト
- 追加依存: Rust (`tokio`, `tokio-cron-scheduler`, `rusqlite`, `chrono-tz` など)、Electron packaging の `extraResources`
- 運用影響: アプリ起動中の常駐プロセス管理、アプリ再起動時のスケジュール復元、通知先セッションの存在確認と失敗処理
