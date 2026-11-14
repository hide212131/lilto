## 技術確認（macOS・Electron 44.9.3・実 Electron）

- 最小化したまま native の `sendInputEvent`／`insertText` は trusted イベントとして着弾する（CDP 入力は不要）。入力配送は既存の native 経路を維持する。
- ページ面の background throttling が既定のままだと、最小化後の `capturePage` は古いフレームを返す。無効化すると最小化中・遮蔽中でも timer／rAF が継続し、`capturePage(…, {stayHidden:true})` が現在のフレームを返す。
- 最小化前に描画済みの文書は最小化中も描画され続けるが、**最小化中に新たに読み込んだ文書（初回 acquire・navigate・back・forward・reload）は描画されない**（rAF が止まり、`capturePage`／CDP screenshot とも失敗）。DOM 操作・入力・evaluate は成立する。よって screenshot はこの場合 `SCREENSHOT_UNAVAILABLE` を明示する。
- ディスプレイがスリープしている間は、新規に作成したビューが描画を開始しない（実測）。

## 設計

- `BrowserHost.getWindowState()` が `{present, visible, minimized, focused}` を一括で返す。`focused` は診断のみで操作条件にしない。
- `environmentError()` を全ツール共通の環境ゲートとし、設定無効・終了・明示 hide・ロック・suspend・モーダル／リサイズの順に判定する。`ctx.check()` でも毎回評価し、配送前後の環境変化を検出する（副作用があり得る場合は `effect` を保持し、`retryable` にしない）。
- `surfaceReady`（ビューが準備済みで表示設定済み）と `operationReady`（`surfaceReady` かつ環境ゲートが開いている）を分け、`panelVisible` は「ユーザーに見える」状態のまま保つ。
- 最小化イベントは state の publish のみ（lease・ビュー・epoch は不変）。復帰時は実ジオメトリが測定時と異なる場合だけ再測定する。明示 hide は `hideWindowExplicitly()` が先にコントローラへ通知する。最小化中のリサイズ・ゼロサイズ測定で有効な操作面を上書きしない。
- background throttling は owner が agent の間だけ無効化し、owner が変わる・dispose で復元する。Electron に getter がないため復元値は既定の true とする。`powerSaveBlocker` は使わない。
- `BrowserLayoutSync` は rAF が走らない場合に備え、期限付き timer でも測定を通知する。
- screenshot は 2 フレーム待ち（3 秒）→ `capturePage` 3 秒期限 → サイズ検証の順で、いずれの失敗も `SCREENSHOT_UNAVAILABLE`。
