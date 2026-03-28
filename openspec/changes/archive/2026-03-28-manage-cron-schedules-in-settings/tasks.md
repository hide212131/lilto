## 1. Scheduler IPC Surface

- [x] 1.1 Main プロセスに schedule 一覧取得・削除用の IPC ハンドラを追加し、既存 `SchedulerService` を再利用できるようにする
- [x] 1.2 preload と Renderer 型定義に schedule 一覧取得・削除 API を追加する

## 2. Settings UI

- [x] 2.1 `lilt-settings-modal` に `Schedules` タブを追加し、一覧読み込み・空状態・失敗状態を表示できるようにする
- [x] 2.2 schedule 行ごとの削除操作と、削除成功後の一覧再取得・状態文言更新を実装する

## 3. Verification

- [x] 3.1 Settings UI 契約テストと scheduler UI 契約テストを更新し、新しいタブと IPC 公開面を固定する
- [x] 3.2 変更後の OpenSpec artifact と実装境界が一致していることを確認し、必要な動作確認結果を記録する