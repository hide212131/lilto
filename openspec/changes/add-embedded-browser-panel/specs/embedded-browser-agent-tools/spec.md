## ADDED Requirements

### Requirement: 専用 MCP でブラウザを操作できる
ON のとき、通常会話の実行に `lilto_browser` MCP server を登録しなければならない（SHALL）。tool は固定集合（status／acquire／release／navigate／back／forward／reload／snapshot／click／fill／select／press／scroll／get_text／screenshot／wait）とし、任意 JavaScript・selector・座標クリック・外部で開くを公開してはならない（SHALL NOT）。

#### Scenario: 入力検証
- **WHEN** 追加プロパティ・範囲外の値・不正な discriminated union を受け取る
- **THEN** JSON-RPC の不正引数エラーを返し、Controller を呼ばない

#### Scenario: 結果の形式
- **WHEN** tool が成功する
- **THEN** `structuredContent` と同内容の JSON text を返し、screenshot は MCP image content を含む。業務エラーは `isError` と `{code,message,retryable,effect}` を返す

### Requirement: 実行単位の capability と所有権
認証は run ごとの token によってのみ行い、body の自己申告を根拠にしてはならない（SHALL NOT）。別 run／別会話／ユーザーが所有中の acquire は `BROWSER_BUSY` としなければならない（SHALL）。

#### Scenario: 失効
- **WHEN** ユーザーが手動操作へ切替・パネルを閉じる・ウィンドウ非表示・モーダル表示・設定 OFF・run 終了・中断が起きる
- **THEN** lease を失効し、待機中・キュー中の操作を取り消し、以後の操作は入力を配送しない

### Requirement: Bridge の防御
Bridge は `127.0.0.1` のみで listen し、`POST /command`・`application/json`・Bearer token（定時間比較）・Origin 付き拒否・Host 検証・body 64 KiB・response 2 MiB・同時数上限（429）を満たさなければならない（SHALL）。

#### Scenario: 切断
- **WHEN** HTTP が切断される、または run が終了する
- **THEN** AbortSignal を伝播し、待機中の操作を終了する

### Requirement: snapshot と ref
`browser_snapshot` は `dom-v1` 形式を返し、ref は `b<ownership>-d<document>-n<node>` とする。操作には最新 `snapshotId` を必須とし、navigation・SPA 遷移・所有権移行・60 秒経過で失効させなければならない（SHALL）。

#### Scenario: 古い ref
- **WHEN** 古い snapshot の ref、または意味が変わったノードを操作する
- **THEN** `STALE_REF` を返し、selector で再解決しない

### Requirement: 副作用の扱い
副作用があり得る操作は自動再試行してはならず（SHALL NOT）、タイムアウト時は `effect` を `possible` または `applied` として返さなければならない（SHALL）。

#### Scenario: クリックのタイムアウト
- **WHEN** click など副作用があり得る操作がタイムアウトする
- **THEN** 操作を自動再試行せず、結果の `effect` を `possible` または `applied` として返し、成否を未確定のまま断定しない
