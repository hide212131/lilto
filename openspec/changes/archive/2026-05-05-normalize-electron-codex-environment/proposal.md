## Why

Windows で Electron アプリを Explorer やスタートメニューから起動した場合、`cmd` や `PowerShell` を対話起動したときと同じ環境変数セットになるとは限らない。現在の lilto は `new Codex({ env })` にほぼそのまま `process.env` を渡しているため、`PATH` や shell 初期化由来の環境差分によって、Electron 起動時だけ Codex 実行や補助コマンド解決が不安定になる。

## What Changes

- Electron 起動時の親環境と、対話 shell 相当の実行環境を切り分けて扱い、Codex 実行用の正規化済み environment を構築する。
- `new Codex({ env })` に渡す environment で、`CODEX_HOME` や proxy などの lilto 管理値を維持しつつ、`PATH` を含む shell 由来の必要環境を補完できるようにする。
- Windows では `cmd` / `PowerShell` と Electron 起動で差が出やすい環境変数について、優先順位と補完ルールを定義する。
- Codex SDK 用 environment builder を単独で検証できるようにし、Electron 起動時と shell 起動時の差分があっても期待する env が Codex に渡ることをテストで固定する。

## Capabilities

### New Capabilities

### Modified Capabilities
- `pi-main-agent-runtime`: Codex runtime 起動時に、Electron 親プロセスの生環境ではなく、Codex 実行向けに正規化・補完した environment を渡す要件へ更新する

## Impact

- 影響範囲: `src/main/agent-sdk.ts`, `src/main/index.ts`, 必要に応じて共通 env 解決 helper
- テスト影響: Agent runtime の environment 構築テスト、Windows 環境差分を模したユニットテスト
- 互換性: 既存の `CODEX_HOME`、proxy、Windows sandbox 設定は維持しつつ、`PATH` などの決定元と上書き順が明示化される