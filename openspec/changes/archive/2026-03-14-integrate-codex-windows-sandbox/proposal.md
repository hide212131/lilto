## Why

現在の lilto は Codex SDK 実行時に `sandboxMode` を `danger-full-access` へ固定しており、Windows 上でも `codex-rs/windows-sandbox-rs` を利用した保護付きツール実行へ切り替えられない。さらに、設定画面・初回セットアップ・失敗時の案内が未接続のため、Codex 側の Windows sandbox 機能を利用者が有効化して安全に運用する導線が不足している。

## What Changes

- Providers & Models に Codex Windows sandbox の設定項目を追加し、`off` / `unelevated` / `elevated` を利用者が選択できるようにする。
- Main の Codex thread 起動設定を見直し、Windows sandbox 利用時は `workspace-write` と Codex config override を渡して Windows sandbox backend が選択されるようにする。
- 初回利用時または未セットアップ時に Codex app-server の Windows sandbox setup API を起動し、完了・失敗・キャンセルを UI へ返す導線を追加する。
- セットアップ未完了や非対応モード時に、実行拒否・設定自動巻き戻し・再試行案内を一貫したエラー処理として整備する。
- Windows sandbox 利用中の制約を考慮し、未対応の `danger-full-access` / 制限付き read-only 要求を Windows では選ばない実行契約へ更新する。

## Capabilities

### New Capabilities
- `codex-windows-sandbox-setup`: Windows sandbox の初回セットアップ開始、進行状態、完了通知、失敗時フォールバック導線を扱う。

### Modified Capabilities
- `pi-main-agent-runtime`: Codex thread 起動時の sandbox 設定、Windows sandbox 前提の実行拒否、セットアップ状態確認、Codex app-server 連携の要件を更新する。
- `providers-models-settings`: Providers & Models 画面に Windows sandbox モード設定と状態表示を追加し、設定保存と不足条件の表示要件を更新する。

## Impact

- Main プロセスの Codex 起動経路: `src/main/agent-sdk.ts`, `src/main/model-catalog.ts`, `src/main/index.ts`
- 設定保存・UI 表示: provider settings 関連の Main/Renderer 実装、IPC 契約
- Codex 連携方式: `@openai/codex-sdk` の `config` / `sandboxMode` 指定、および `codex app-server` の `windowsSandbox/setupStart` 利用
- Windows 専用挙動: `CODEX_HOME` 配下の sandbox setup 状態管理、セットアップ失敗時のエラーハンドリング、Windows 実機テスト