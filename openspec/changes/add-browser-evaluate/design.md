## Context

設計書 `lilto-dev/designs/browser-evaluate-design.md`（Issue #38）の要約。決定事項は設計書が正であり、ここでは実装の根拠となる要点を残す。`add-embedded-browser-panel` の design.md にある「公開しないもの: 任意コード実行」「固定 16 tool」「認証」の決定を、本 change で次のとおり更新する。

## Decisions

| 項目 | 決定 |
|---|---|
| ツール | `lilto_browser` に `browser_evaluate` を追加。既存の MCP → Bridge → Main の認証・所有権を利用 |
| 実行世界 | 対象 frame のページ自身の JS 環境（main world） |
| スクリプト | 引数なしの async 関数本体（`return`／`await` 可）。式・関数文字列の自動判別はしない |
| frame | メインフレームと、snapshot の frame 一覧が返す不透明 `frameId`（View・所有権・文書・世代・60 秒 TTL に束縛） |
| 結果 | JSON 値またはトップレベル `undefined`。UTF-8 64 KiB、深さ 32、値 10,000。超過は `RESULT_TOO_LARGE`（切り詰めない） |
| 期限 | 既定 10 秒、100 ミリ秒〜30 秒。待機は Main の期限と race する |
| ゲート | evaluate 有効・有効な run／lease・パネル可視・ウィンドウフォーカス・`documentEpoch` 一致 |
| snapshot | `snapshotId` 不要。配送時に既存 snapshot を失効 |
| 副作用 | 全 evaluate を副作用あり得る操作とし、自動再試行しない |
| 設定 | `browserSettings.evaluateEnabled`、既定 `false`（既存ユーザーに実行権限を自動追加しない） |
| 登録数 | ブラウザ ON・evaluate OFF で 16、両方 ON で 17 |
| 認証ページ | 内蔵セッションで表示中の認証済みページでも実行可能（UI の注意文で明示） |

### 主な契約

- 構文確認: `AsyncFunction` コンストラクタによる compile-only で行い、ラッパを脱出する入力を許さない。
- 配送: 文書ごとのランダム token をページに置き、配送コード先頭で一致を確認する（navigation と配送の競合による新文書への誤配送を防ぐ）。実機検証で、検査後〜配送の間に始まった navigation の誤配送が起き得ることを確認済み。
- 対象 origin: Main の `frame.origin` で HTTP(S) か判定する（ページ自己申告は使わない）。opaque／`data:`／sandbox 付きは実行しない。
- 世代: `frameTreeNodeId` ごとに navigation イベントで世代カウンタを進める。detach 後は `STALE_FRAME`。
- 未完了配送: 同期無限ループ中の `executeJavaScript` Promise は永久に settle しないため、期限・取消で verdict を出し、対象 View を lease 失効のうえ `close({waitForBeforeUnload:false})` し、破棄確認まで新 View を作らない。
- 設定反映: `evaluateEnabled` の変更でも capability 停止・token／lease 失効・実行中断・MCP client 終了を行う。evaluate を無効化するとき、evaluate を配送した View は閉じる。セッションデータと skill policy は変更しない。
- MCP: `tools/list` は run 開始時の設定スナップショット（env `LILTO_BROWSER_EVALUATE_ENABLED`）で 16／17 を切り替える。直接呼び出しは Main が最終判断する。

## Risks

- 認証済みページ上で任意 JS が走るため、プロンプトインジェクション経由の操作リスクが増える。既定 OFF・明示トグル・注意文・auto-retry なしで緩和する。
- 変換処理は、ページ世界の組み込みや Proxy を含む任意 JS に対する完全な安全境界ではない。変換中の停止も Main の期限監視の対象とする。
- 取消は待機と以後の配送を終了するのみで、既に発生したページ変更・通信・サーバー変更は巻き戻せない。
