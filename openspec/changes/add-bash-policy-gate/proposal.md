## Why

`pi` の built-in `bash` には公開オプションとして Allow / Deny リストがなく、現状の lilto では AI が生成した Bash コマンドを実行前に組織ポリシーで制御できません。危険コマンドの一律拒否、要確認、監査記録を運用で切り替えられる仕組みを追加し、通常の開発作業を大きく阻害せずに Bash 実行の安全性を上げる必要があります。

## What Changes

- Pi extension の `tool_call` フックを使って `bash` 呼び出しを実行前に検査する `bash policy gate` を lilto の agent runtime に追加する。
- YAML ベースのポリシー設定で `deny` / `confirm` / `allow` / `audit` を定義できるようにし、正規表現と保護パス条件によるルール評価を提供する。
- `confirm` 判定時は UI 確認、`deny` 判定時は理由付きブロック、`audit` 判定時は JSON Lines の監査ログ記録を行う。
- 初版は built-in `bash` を置き換えず、既存 Bash ツールの前段ガードとして実装する。将来の `bash` override は拡張案として設計に含める。
- Windows を含む既存 runtime 互換性を維持しつつ、設定不備時の fail-safe 動作と代表的な危険コマンドの自動テストを追加する。

## Capabilities

### New Capabilities
- `bash-policy-gate`: Bash 実行前に Allow / Deny / Confirm / Audit を判定し、設定ファイルと監査ログで運用できる capability

### Modified Capabilities
- `pi-main-agent-runtime`: Main プロセスの Pi 実行が Bash policy gate extension を読み込み、`bash` tool 呼び出し前にポリシー判定と確認 UI を介在できるよう requirement を変更

## Impact

- 影響コード: `src/main/agent-sdk.ts`, `src/main/config.ts`, `src/main/logger.ts`, 必要に応じて `src/shared/*` と preload / renderer の確認 UI 導線
- 追加資産: policy loader / engine、拡張エントリポイント、YAML 設定ファイル、監査ログ出力、runtime テスト
- 外部参照: `pi-mono/packages/coding-agent` の extension API と built-in `bash` ツール仕様、`permission-gate` 例
- 運用影響: ポリシー未設定または破損時の既定動作、監査ログ保存先、Windows の `.cmd` 優先実行と整合する Bash 判定
