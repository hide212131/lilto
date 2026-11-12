## Context

正本は `sticky-browser-instructions-redesign.md`（Issue #43）。本書は実装の根拠となる決定と実装結果の要点を残す。

## Decisions

| 項目 | 決定 |
|---|---|
| 更新経路 | `turn/start.additionalContext`、キー `lilto_browser_state`、`kind: "application"` |
| 状態 | `{ browser: on/off, evaluate: 実効値, instructionDigest: 完成文面の SHA-256 }`。3 項目の完全一致で比較。evaluate は `browser == on && 設定` |
| 文面 | 状態変化時は差分でなくフル文面。先頭に supersede 宣言（lilto のブラウザ指示だけを失効対象にする）。文面に token・時刻・request ID を入れない |
| 保存 | `userData/browser-instruction-state.json`、`namespaces[sha256(Codex Home)][threadId]`。main process が単一所有、書込は直列化・同一ディレクトリの一時ファイルから原子的に置換 |
| 確定 | 送信前に pending を保存（保存失敗なら turn なし）→ 正常完了で confirmed。失敗・中断・接続断・クラッシュ後の pending・圧縮は unknown。失敗後に旧 confirmed へ戻さない |
| 競合 | (Codex Home, thread) 単位でターン全体を占有。競合は拒否。完了書込は attemptId と generation の一致が必須 |
| 継続性 | 圧縮で状態項目は消える。`item/started`（contextCompaction）を client が行を解析した時点で購読して `turn/interrupt`、unknown 化、次ターンで再送。同一 thread で圧縮停止が連続する場合は、圧縮破棄の無限ループを避けるため 2 回目は完了後に停止 |
| 中断の見え方 | 圧縮停止は retryable なエラーとして表示し、再送信で続行する |
| 対象外 | heartbeat・fresh・実効 ephemeral・内部 service・会話 ID なし。永続的な通常会話の scheduler follow-up は対象 |
| ON 発行不能 | OFF に倒さず run を開始前に失敗させる。設定適用中も同様 |
| SDK 入口 | ブラウザ管理対象 run は同じ App Server adapter に委譲する |
| 採用しないもの | X3 `collaborationMode.settings.developer_instructions`、rollout の走査・編集、毎ターン送信 |
