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

## 圧縮停止の判定（実測による）

- 停止は `item/started`（contextCompaction）を `CodexAppServerClient.onNotification` で行を解析した時点に購読して行う。利用側が通知を引く速さに依存しない。`item/completed` 契機には頼らない。
- 圧縮が当該ターンの `userMessage` より前（pre-turn）で、そのターンが更新を送る場合は、更新は圧縮後の入力に入る（実 App Server と実プロバイダで確認）ので停止しない。それ以外（mid-turn、または更新を送らない pre-turn）は状態が消えるので止める。いずれも確定はしない。
- 停止は圧縮を破棄し、トークン見積もりは通常応答でしか更新されない。そのため連続停止は無限ループになり得る。1 回停止した thread の再試行ターンは停止しない（再試行は更新を送る）。
- 実 Electron main（記録サーバー別プロセス）での interrupt 遅延は main の停止時間にほぼ等しい。圧縮リクエストの所要時間より main の停止が短ければ間に合う。実プロバイダの圧縮リクエストは約 6〜8 秒（本 change の実測）。
- 間に合わなかった場合の保証は「その 1 ターンの残りは状態なしで進み得る。確定していないので次ターンで再送される」まで。
