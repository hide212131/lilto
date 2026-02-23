## 1. 調査とイベント契約の確定

- [x] 1.1 `PI_REPO_DIR` の `pi-web-ui` / `pi-agent-core` 実装を確認し、利用するイベント種別（`tool_execution_start/end`・終端系）を `docs` または change 内メモに整理する
- [x] 1.2 Main->Renderer の loop event ペイロード型を `src/main/ipc-contract.ts` と `src/renderer/types.ts` に追加し、既存 `promptResult` 契約との互換性を明記する
- [x] 1.3 `src/preload.ts` に loop event 購読 API（例: `onAgentLoopEvent`）を定義し、解除関数を返す契約を追加する

## 2. Main プロセスのイベント中継実装

- [x] 2.1 `src/main/agent-sdk.ts`（または実行経路）でエージェント実行イベントを購読し、UI向け正規化イベントへ変換する
- [x] 2.2 `src/main/ipc.ts` / `src/main/index.ts` に loop event 配信チャネルを追加し、Renderer ウィンドウへ逐次送信する
- [x] 2.3 正常完了・失敗・中断の全経路で終端通知が必ず送信されるよう cleanup を共通化する

## 3. Lit UI の可視化ポーティング

- [x] 3.1 `src/renderer/app.ts` に `loopState`（進行ステータス、実行中ツール集合、終端状態）を追加し、購読イベントで更新する
- [x] 3.2 `src/renderer/components/top-bar.ts` または `src/renderer/components/message-list.ts` に実行中ステータス表示を追加する
- [x] 3.3 実行中ツール一覧 UI をコンポーネント化し、`tool_execution_start/end` で追加/削除される描画を実装する
- [x] 3.4 実行終端時に進行中表示を確実にクリアし、既存メッセージ履歴表示が壊れないことを確認する

## 4. 検証と回帰防止

- [x] 4.1 Main のイベント正規化ロジックの単体テストを追加し、開始/終了/失敗のイベント送出を検証する
- [x] 4.2 Renderer の state 遷移テストを追加し、実行中ツール一覧の追加・削除と終端クリアを検証する
- [x] 4.3 `npm run test` を実行し、関連テストログで回帰がないことを確認する
- [x] 4.4 GUI 変更検証として `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する
