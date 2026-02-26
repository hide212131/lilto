## 1. イベント契約の拡張

- [x] 1.1 `src/shared/agent-loop.ts` に `thinking_delta` イベント型（`requestId`, `delta`）を追加する
- [x] 1.2 `reduceLoopState` が `thinking_delta` を受けても既存状態遷移を壊さないことを確認し、必要なら no-op ハンドリングを追加する

## 2. main プロセスで thinking 増分を中継

- [x] 2.1 `src/main/agent-sdk.ts` の `session.subscribe` で `message_update` / `assistantMessageEvent.type === "thinking_delta"` を検出し、loop event に変換する
- [x] 2.2 既存 `run_start` / `tool_execution_*` / `run_end` の送出順と `submitPrompt` 戻り値契約が変わっていないことを確認する

## 3. renderer で実行中表示へ反映

- [x] 3.1 `src/renderer/app.ts` に thinking 本文バッファを追加し、`thinking_delta` 受信時に pending assistant テキストへ追記する
- [x] 3.2 既存の進捗行（ツール開始など）と thinking 本文を合成する表示ロジックを整理し、両方が同時表示されるようにする
- [x] 3.3 実行完了・失敗・新規セッション開始時に thinking バッファを適切にクリアする
- [x] 3.4 `src/renderer/components/message-list.ts` で thinking のデフォルト折りたたみ、行数プレビュー、残り行展開を実装する
- [x] 3.5 `src/renderer/components/message-list.ts` で thinking 開閉状態をセッション中に保持し、再描画時に復元する
- [x] 3.6 `src/renderer/app.ts` で `run_start` の requestId を pending assistant メッセージへ紐付ける
- [x] 3.7 `src/renderer/components/message-list.ts` の開閉状態キーを requestId 優先（fallback: message ID）へ変更する

## 4. 型・表示・回帰確認

- [x] 4.1 `src/renderer/types.ts` と preload 境界の型整合性を確認し、必要な型追従を行う
- [x] 4.2 `npx tsc -p tsconfig.json --noEmit` を実行し、型エラーがないことを確認する
- [x] 4.3 `npm run e2e:electron` を実行し、GUI変更後の E2E 成功と `test/artifacts/electron-e2e.png` 生成を確認する
