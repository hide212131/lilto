## Why

Electron アプリの GUI 変更に対して、実動作を伴う検証基盤が不足しており、回帰を早期に検出しづらい。`agent-browser` を用いた E2E 検証を導入し、GUI 変更時に E2E を必須化することで、変更の品質と再現性を高める。

## What Changes

- Electron の動作確認手段として `https://github.com/vercel-labs/agent-browser` を利用するための検証フローを追加する。
- GUI 変更を含むタスクの完了条件に「E2E 実施と結果確認」を必須項目として追加する。
- 完了前チェック時に、GUI 変更がある場合は E2E 未実施のまま完了にできない運用ルールを明文化する。

## Capabilities

### New Capabilities

- `electron-gui-e2e-validation`: `agent-browser` を利用して Electron の GUI 操作を E2E で検証できることを定義する。
- `gui-change-e2e-completion-gate`: GUI 変更を含む作業では、E2E 実行結果の確認なしに完了にしない運用要件を定義する。

### Modified Capabilities

- なし

## Impact

- 対象ドキュメント: `AGENTS.md`（完了条件ルールの更新）
- 対象ワークフロー: OpenSpec change の design/specs/tasks（GUI 変更時 E2E 前提のタスク化）
- 依存関係: `agent-browser` の導入・利用手順、E2E 実行環境（Electron 起動を含む）
