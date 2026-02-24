## 1. トップバーの新規セッション操作追加

- [x] 1.1 `lilt-top-bar` のプラスボタンに `new-session` イベント発火処理を追加する
- [x] 1.2 `lilt-top-bar` に送信中無効化用のプロパティ（例: `newSessionDisabled`）を追加し、ボタンの `disabled` に反映する

## 2. アプリ状態のセッション初期化実装

- [x] 2.1 `lilt-app` で `new-session` イベントを受け取り、`messages`・`loopState`・進行表示内部状態を初期化する
- [x] 2.2 `isSending` と連動して新規セッションボタンを無効化し、送信中の誤クリアを防止する

## 3. 検証

- [x] 3.1 関連ユニットテスト（または既存テスト）を更新し、新規セッション開始時の状態初期化を検証する
- [x] 3.2 `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する
