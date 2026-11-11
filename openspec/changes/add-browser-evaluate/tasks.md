## 1. 基準仕様と新 change

- [x] 1.1 `add-browser-evaluate` の proposal・design・spec delta・tasks を作成し、`openspec validate add-browser-evaluate --strict` を通す。オーナー承認日（2026-11-11）と禁止条項を変更する理由を proposal に明記する。
- [ ] 1.2 `add-embedded-browser-panel` を `openspec/specs/` へ同期・archive してから、本 change を archive する（存在しない基準 Requirement に MODIFIED を適用したままにしない）。

## 2. 共有契約

- [x] 2.1 evaluate の入出力型・上限・エラーコード（`EVALUATE_DISABLED`、`STALE_FRAME` ほか）、`evaluateEnabled`、snapshot の frame 情報を `src/shared/browser.ts` に追加する。
- [x] 2.2 引数・UTF-8・要求全体サイズの検証を `browser-tool-contract.ts` に追加し、16／17 ツールの切替を実装する。

## 3. frame 管理と Electron adapter

- [x] 3.1 frame の列挙・世代追跡・不透明 `frameId`（60 秒 TTL）・対象 origin 検証を `browser-frames.ts` に実装する。

## 4. evaluate 実行と結果変換

- [x] 4.1 async 関数本体の構文確認、制限付き JSON シリアライザ、token guard、Main 側再検証を `browser-evaluate.ts` に実装する。

## 5. Controller と取消

- [x] 5.1 配送前後のゲート、共有 deadline、snapshot 失効、取消、未完了 View の利用停止・破棄・回復を `embedded-browser.ts` に実装する。

## 6. MCP／Bridge

- [x] 6.1 16／17 ツールの公開切替、Main による最終拒否、通信失敗・応答上限での effect 保持、自動再送の防止。
- [x] 6.2 stdio MCP の出力を drain してから終了する（大きな `tools/list` の切り捨て防止）。Bridge の 413 は応答を送り切ってから接続を閉じる。

## 7. 設定保存と UI

- [x] 7.1 旧設定の補完・部分保存・検証、権限変更時の停止、設定タブのトグルと注意文。

## 8. Codex 向け案内

- [x] 8.1 tool description と developer instructions を evaluate 有効時に更新する。

## 9. unit と実 Electron 検証

- [x] 9.1 契約・シリアライズ・ゲート・設定・通信の unit を追加し、`node --test` の並行実行が完走することを確認する（テスト側の後片付け漏れを修正）。
- [x] 9.2 `scripts/verify-embedded-browser.js` で frame 内 evaluate（同一 origin／別プロセス）・無限ループ打ち切り・取消・回復を実 Electron で検証する（83/83）。
- [x] 9.3 `scripts/verify-app-server-mcp.js` で同梱 App Server 経由の 16／17 ツール公開と evaluate 実行を検証する（22/22）。

## 10. ライブ UI・最終回帰

- [x] 10.1 `/live-ui-manual-verification` で設定タブのトグルと操作を確認する。
- [x] 10.2 全機能変更後、最後に `npm run e2e:electron` を成功させ、`test/artifacts/electron-e2e.png` を確認する。
