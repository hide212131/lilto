## 1. IPC 層の分割

- [x] 1.1 `src/main/ipc.ts` のハンドラをドメイン別に棚卸しし、`src/main/ipc/` 配下へ切り出す単位を決める
- [x] 1.2 `ipc-contract.ts` を唯一の契約として維持したまま、domain ごとの `register*IpcHandlers` モジュールを追加する
- [x] 1.3 上位の IPC 集約エントリを更新し、`test/ipc-characterization.test.js` を通して公開契約が不変であることを確認する

## 2. Runtime 巨大ファイルの責務分離

- [x] 2.1 `agent-sdk.ts` を facade と内部モジュールへ分け、ライフサイクル、イベント処理、エラー分類、設定組み立てを責務別に移す
- [x] 2.2 `test/agent-runtime.test.js` を実行し、agent runtime の公開挙動を維持していることを確認する
- [x] 2.3 `skill-runtime.ts` を discovery、execution、sandbox policy のモジュールへ分割する
- [x] 2.4 `test/skill-runtime.test.js` を実行し、skill runtime の既存契約を維持していることを確認する

## 3. 補助サービスと composition root の整理

- [x] 3.1 `plugin-service.ts` と `heartbeat-assistant.ts` の補助ロジック境界を洗い出し、必要な characterization test を先に追加する
- [x] 3.2 両サービスを公開 entry point と補助ロジック群へ分割し、既存テストまたは追加した特性テストで挙動を固定する
- [x] 3.3 `src/main/index.ts` をサービス生成、依存配線、IPC 登録だけを担う composition root へ純化する

## 4. 統合検証

- [x] 4.1 `npm test` を実行し、main プロセス分割後も既存の総合検証を通過することを確認する
- [x] 4.2 分割後の main プロセス構造を見直し、`index.ts` が配線専用であることと巨大ファイルが責務別に分解されたことを確認する
- [x] 4.3 フェーズ 3 へ渡すため、残課題と追加で必要な characterization test の有無を change 内へ反映する