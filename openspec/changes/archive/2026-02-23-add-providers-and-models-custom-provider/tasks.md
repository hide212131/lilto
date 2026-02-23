## 1. Settings UI を Providers & Models へ再編

- [x] 1.1 `src/renderer/index.html` の Settings メニューを `Claude Auth` から `Providers & Models` へ変更し、Claude セクションと Custom Provider セクションの UI 骨格を追加する
- [x] 1.2 `src/renderer/renderer.ts` で設定モーダル表示・切替ロジックを更新し、Claude OAuth 操作と Custom Provider 入力フォームを同一画面で扱えるようにする
- [x] 1.3 `pi-web-ui` 参照実装（`packages/web-ui/src/dialogs/ProvidersModelsTab.ts`）との差分を確認し、文言・導線・必須入力の責務が一致することを手動確認する

## 2. Provider 設定の保存と Main 実行分岐

- [x] 2.1 preload/main IPC に provider 設定の取得・保存 API を追加し、起動時 hydrate と更新時保存を実装する
- [x] 2.2 Main の `submitPrompt` 実行前検証を provider 別条件（Claude OAuth / Custom Provider 必須設定）へ拡張し、不足時の標準化エラーを定義する
- [x] 2.3 Custom Provider（OpenAI Completions Compatible）向け実行経路を追加し、設定値に基づく接続先で応答を返す

## 3. 検証と完了条件

- [x] 3.1 単体/統合テストを更新し、Claude と Custom Provider の成功・失敗（未設定）シナリオを検証する
- [x] 3.2 GUI 変更の完了条件として `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する
- [x] 3.3 実装ログと差分を確認し、既存チャット機能の回帰がないことを確認して OpenSpec artifact と整合を取る
