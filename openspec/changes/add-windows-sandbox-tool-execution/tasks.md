## 1. 設定とUIの追加

- [x] 1.1 設定スキーマに `useWindowsIsolatedToolExecution`（boolean, デフォルト OFF）を追加し、旧 `useWindowsSandboxForTools` を後方互換で読む
- [x] 1.2 設定画面に Windows 分離実行の ON/OFF トグルを追加し、変更を永続化できるようにする
- [x] 1.3 Windows 以外では当該トグルを非表示または無効化し、既存UIへの影響を最小化する

## 2. 実行モード分岐の実装

- [x] 2.1 Main 側にツール実行モード判定（`host` / `windows-isolated`）を実装する
- [x] 2.2 Pi SDK の resourceLoader / Extensions 注入経由で Bash/Edit/Write を切り替え、OFF 時は既存ホスト実行を維持する
- [x] 2.3 実行ログにモード・設定値・失敗ステップを出力し、トラブルシュート可能にする

## 3. Windows 分離実行アダプタ

- [x] 3.1 `windows-sandbox-rs` を参考にした最小アダプタ（実行・結果回収・後片付け）を追加し、Pi Extension override から利用できるようにする
- [x] 3.2 ON 時にのみ Sandbox の最小環境構築を実行する処理を実装する
- [x] 3.3 Sandbox 利用不可/起動失敗時に、原因を明示したエラーを返し暗黙フォールバックしない

## 4. 検証

- [x] 4.1 Windows で設定 OFF の既存実行フロー回帰確認（Bash/Write）を行う
- [ ] 4.2 Windows で設定 ON 時に Sandbox 経由で実行されることを確認する
- [ ] 4.3 GUI 変更として `/live-ui-manual-verification` を実施し、最後に `npm.cmd run e2e:electron` で最終E2Eを通す
