## Why

内蔵ブラウザ連携を ON にして作った会話に、「外部ブラウザを起動しない」「`lilto_browser` だけを使う」という lilto 固有の指示が developer 項目として残る。設定を OFF にした後も同じスレッドで外部ブラウザ作業を拒否し、再度 ON にしても指示の有効範囲が曖昧なままになる（Issue #43）。

実測（同梱 App Server 0.163.0）で次が確定している。

- `thread/start` の `developerInstructions` は有効だが、`thread/resume` の同項目と `config.developer_instructions` は無効。
- `turn/start.additionalContext`（`kind: "application"`）は developer 項目として追記され、同文でも増える。
- 自動・明示の圧縮後は、additionalContext の状態項目が入力から消える。再起動（圧縮なし）では復元される。
- 圧縮は通知 `item/started`（`item.type = "contextCompaction"`）で圧縮リクエストより前に観測でき、`turn/interrupt` で後続のモデル要求を止められる。

## What Changes

- ブラウザ指示の更新は `turn/start.additionalContext` で送る。新規スレッドも初回ターンに送り、この機能では `thread/start`／`thread/resume` の `developerInstructions` を使わない。
- 送るのは、状態（連携 ON/OFF・実効 evaluate・完成文面の SHA-256）が最後に確定した状態と異なるとき、または状態不明のときだけ。ブラウザ OFF 中の evaluate 設定変更は状態変化としない。
- 最後に伝えた状態を (Codex Home, thread ID) 単位で `userData/browser-instruction-state.json` に永続化する。送信前に pending を保存し、ターン正常完了で confirmed、失敗・中断・クラッシュ・圧縮は unknown とする。未記録・破損した記録も unknown。
- 圧縮を検知した managed run は `turn/interrupt` で継続前に止め、状態を unknown に戻す。次の通常ターンでフル文面を再送する。
- 同じ backend thread への並行 run は拒否する。heartbeat・fresh・ephemeral・内部 service・会話 ID なしの run は状態を送らず記録しない。
- ON で capability を発行できない（bridge 停止・発行失敗・設定適用中）場合は OFF とみなさず、turn・打消し・記録なしで run を失敗させる。
- 回復方法は「OFF のまま既存会話を続ける」。スレッドの作り直しは要求しない。
- 本 change は #42（最小化・表示・ownership）の requirement を変更しない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `embedded-browser-agent-tools`: 基準仕様がまだ `openspec/specs/` に存在しないため、独立した Requirement として追加する（ADDED）。

## Impact

- `src/main/agent-sdk-config.ts`（状態・フル文面・digest）、`browser-instruction-state-store.ts`（新規）、`browser-run-support.ts`、`agent-sdk.ts`、`agent-sdk-types.ts`、`codex-app-server-client.ts`、`browser-settings-flow.ts`、`main-runtime.ts`。
- テスト、`scripts/helpers/` の実 App Server 検証ハーネス、`.github/workflows/quality-gate.yml`。
