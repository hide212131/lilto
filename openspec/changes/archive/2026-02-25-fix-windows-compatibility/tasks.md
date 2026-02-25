## 1. 実行経路の Windows 互換化

- [x] 1.1 Main 側のコマンド実行箇所を整理し、Windows の場合に `npm.cmd` / `npx.cmd` / `openspec.cmd` を選択する共通処理を実装する
- [x] 1.2 パス区切り・引数解釈の差異を吸収する正規化処理を追加し、既存の Linux/WSL2 経路を維持する

## 2. ランタイム統合とエラーハンドリング

- [x] 2.1 `pi-main-agent-runtime` の実行フローへ OS 互換分岐を統合し、Windows で CLI 起動失敗時のリカバリ/エラー整形を実装する
- [x] 2.2 `desktop-shell` 起動フローで Windows 実行制約を吸収し、起動時に必要なコマンドが継続実行できることを確認する

## 3. 仕様・手順の更新

- [x] 3.1 Windows での OpenSpec 実行手順（`.cmd` 優先）を関連ドキュメントへ反映する
- [x] 3.2 既存運用手順との不整合がないように README / docs / AGENTS の参照導線を更新する

## 4. 検証と回帰確認

- [x] 4.1 Windows で `new change` → `status` → `instructions` が成功することを実機で確認する
	- 2026-02-25: `openspec.cmd new change "windows-compat-smoke"` → `openspec.cmd status --change "windows-compat-smoke" --json` → `openspec.cmd instructions proposal --change "windows-compat-smoke" --json` を実行し成功。確認後 `openspec/changes/windows-compat-smoke` を削除。
- [x] 4.2 WSL2/Linux で既存フローが回帰していないことを確認し、結果を記録する
	- 2026-02-25: 実機で `wsl.exe` にディストリビューション未導入のため WSL 実行は不可。代替として `test/windows-compatibility.test.js` に Linux 経路（`createCliCompatibilityMap("linux")`）の回帰テストを追加し、`npm.cmd run test` で pass を確認。