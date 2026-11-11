## Why

内蔵ブラウザの AI 連携（`add-embedded-browser-panel`）は、任意 JavaScript の実行を「公開してはならない（SHALL NOT）」と定めていた。このため、固定ツールでは表現できないページ内の読み取り・操作（ページが公開する関数や状態の参照、iframe 内の操作など）ができない（Issue #38）。

**仕様変更の理由と承認**: Issue #38 に対する 2026-11-11 の製品オーナー承認により、任意 JavaScript 実行の禁止を、独立した設定で有効化できる読み取り・操作機能へ意図的に変更する。実装上の例外ではなく、製品仕様の変更として本 change に残す。旧 change の禁止条項は履歴として上書きせず、本 change の delta で変更する。

## What Changes

- `lilto_browser` に `browser_evaluate` を追加する。引数なしの async 関数本体をページ自身の JavaScript 環境（対象 frame）で実行し、制限された JSON 値を返す。
- 対象はメインフレームと、snapshot が返す不透明 `frameId` で明示指定した子 frame とする。
- `snapshotId` は要求せず、観測済み `documentEpoch` を必須とする。evaluate 配送時は既存 snapshot を失効させる。
- evaluate は常に副作用があり得る操作として扱い、自動再試行しない。配送後の失敗は `effect=possible`・`retryable=false`。
- 結果上限は UTF-8 64 KiB（深さ 32・値 10,000 個）。実行期限は既定 10 秒（100 ミリ秒〜30 秒）。同期無限ループ等で完了しない配送済み View は破棄する。
- 設定 `browserSettings.evaluateEnabled`（既定 `false`）を追加する。ブラウザ ON・evaluate OFF で 16 ツール、両方 ON で 17 ツールを公開する。OFF の直接呼び出しは `EVALUATE_DISABLED`。
- 設定タブにトグルと注意文（認証済みページの読み取り・操作が可能であること、読取専用ではないこと）を追加する。
- Codex 向け案内（tool description・developer instructions）を evaluate 有効時に更新する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `embedded-browser-agent-tools`: 固定 16 ツールかつ任意 JavaScript 非公開の条項を、`evaluateEnabled` 時のみ `browser_evaluate` を加える内容へ変更。所有権・snapshot・副作用の要件を evaluate に合わせて更新し、evaluate の詳細契約を追加。
- `providers-models-settings`: `browserSettings` に `evaluateEnabled` を追加。

## Impact

- Main: Controller（evaluate 実行・期限・View 破棄）、frame 管理、結果シリアライザ、MCP／Bridge、設定保存・反映、Codex 向け案内。
- Renderer／shared: 設定タブのトグル、共有契約（上限・エラーコード・frame 情報）。
- 配布: `browser-mcp-server` の依存閉包（`asarUnpack`）の更新。
- 前提: `embedded-browser-agent-tools` は `openspec/specs/` に未同期で `add-embedded-browser-panel` の ADDED にのみ存在する。本 change の MODIFIED は、その change を同期・archive した後に適用する（先に本 change だけを archive しない）。

## Non-goals

引数（`args`）の受け渡し、任意 selector・座標クリック・CDP command の専用ツール、`readOnly` 指定、ユーザー操作の代行（userGesture）、非 HTTP(S) の frame（opaque origin・`data:`・sandbox 付き）の実行、結果の部分返却（切り詰め）、自動再試行。
