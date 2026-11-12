## 1. 実測

- [x] 1.1 additionalContext の更新直後・自動／明示圧縮後・再起動後の保持と、圧縮通知の観測時点・停止可否を同梱 App Server 0.163.0 で実測する（`task1-redesign-report.md`）。

## 2. 状態と文面

- [x] 2.1 状態の正規化・フル文面（ON／OFF／evaluate）・digest を `agent-sdk-config.ts` に実装する。

## 3. 永続ストア

- [x] 3.1 pending／confirmed／unknown・原子的書込・generation・thread 単位占有を `browser-instruction-state-store.ts` に実装する。

## 4. runtime と adapter

- [x] 4.1 対象分類・ON 発行不能の拒否・設定適用中の抑止を `AgentRuntime`／`browser-run-support.ts`／`browser-settings-flow.ts` に実装する。
- [x] 4.2 App Server adapter で additionalContext 送信・実 thread ID の保持・SDK 入口の委譲を実装する。
- [x] 4.3 圧縮通知の購読・interrupt・unknown 化を実装する。

## 5. 検証

- [x] 5.1 unit（ストア・ライフサイクル・runtime・SDK 委譲）と型検査。
- [ ] 5.2 実 App Server＋記録サーバーでの項目数検証（CI 用の独立モード）。
- [ ] 5.3 papa での実モデル確認（旧履歴回復・再 ON・再起動・自動圧縮・evaluate 往復）。
- [ ] 5.4 ライブ UI 確認と最終 `npm run e2e:electron`。

## 6. リリース資料

- [ ] 6.1 回復方法を「OFF のまま既存会話を続ける」と記載する（スレッド作り直しは要求しない）。
