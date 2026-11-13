## 1. 技術確認

- [x] 1.1 `scripts/probe-minimized-browser.js` で入力・capture・timer／rAF を macOS 実 Electron で実測する（`impl-report.md`）。
- [ ] 1.2 Windows の技術確認を CI（quality-gate の最小化ジョブ）で実行する。

## 2. 実装

- [x] 2.1 state・エラーコード・host 契約（`getWindowState`）。
- [x] 2.2 minimize／hide／restore／close の分離、lock／suspend の接続。
- [x] 2.3 共通環境ゲートと操作面の準備待機（autoOpen、`PANEL_NOT_READY`）。
- [x] 2.4 throttling の無効化と復元、`BrowserLayoutSync` の timer 経路。
- [x] 2.5 OS フォーカス条件の撤廃（入力・evaluate）、screenshot の現在フレーム取得。
- [x] 2.6 Codex 向け案内とツール説明。

## 3. 検証

- [x] 3.1 unit と型検査。
- [x] 3.2 実 Electron の最小化シナリオ（`verify-embedded-browser.js`）と実 App Server 経由（`verify-app-server-mcp.js`）。
- [ ] 3.3 両 OS の CI ジョブ（Windows は PR の CI 結果で確定）。
- [ ] 3.4 対話実機でのライブ UI 検証（画面ロック中は未実施）、最終 `npm run e2e:electron`。
