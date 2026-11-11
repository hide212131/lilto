## MODIFIED Requirements

### Requirement: 専用 MCP でブラウザを操作できる
ON のとき、通常会話の実行に `lilto_browser` MCP server を登録しなければならない（SHALL）。tool は固定 16 ツール（status／acquire／release／navigate／back／forward／reload／snapshot／click／fill／select／press／scroll／get_text／screenshot／wait）に、`browserSettings.evaluateEnabled` が true の場合のみ `browser_evaluate` を加えた集合としなければならない（SHALL）。

任意 JavaScript は `browser_evaluate` を通じてのみ公開しなければならない（SHALL）。script 内での selector 使用や DOM 操作は許可する。任意 selector・座標クリックを直接受け付ける専用ツール、任意の debugger command、外部で開くツールを公開してはならない（SHALL NOT）。

#### Scenario: 入力検証
- **WHEN** 追加プロパティ・範囲外の値・不正な discriminated union を受け取る
- **THEN** JSON-RPC の不正引数エラーを返し、Controller を呼ばない

#### Scenario: 結果の形式
- **WHEN** tool が成功する
- **THEN** `structuredContent` と同内容の JSON text を返し、screenshot は MCP image content を含む。業務エラーは `isError` と `{code,message,retryable,effect}` を返す

#### Scenario: evaluate の無効化
- **WHEN** ブラウザ連携は ON で evaluate が OFF である
- **THEN** `tools/list` は既存 16 ツールを返す
- **AND** `browser_evaluate` の直接呼び出しは Main が `EVALUATE_DISABLED`・`effect=none` で拒否する

### Requirement: 実行単位の capability と所有権
認証は run ごとの token によってのみ行い、body の自己申告を根拠にしてはならない（SHALL NOT）。別 run／別会話／ユーザーが所有中の acquire は `BROWSER_BUSY` としなければならない（SHALL）。evaluate を含むページ操作は、配送直前に有効な lease・表示状態・必要なフォーカス・権限設定を検証しなければならない（SHALL）。

#### Scenario: 失効
- **WHEN** ユーザーの手動切替・パネルを閉じる・ウィンドウ非表示・設定 OFF・run 終了・中断が起きる
- **THEN** lease を失効し、待機中・キュー中の操作を取り消し、以後のツール配送を禁止する
- **AND** 配送済み evaluate が未完了なら対象 View を利用停止し、閉じる

#### Scenario: 一時的な遮蔽
- **WHEN** モーダル表示または resize が始まる
- **THEN** ページ操作を中断し、新しい有効な表示測定までは配送しない
- **AND** 未完了の evaluate が配送済みなら対象 View と lease を失効させる

### Requirement: snapshot と ref
`browser_snapshot` は `dom-v1` 形式を返し、ref は `b<ownership>-d<document>-n<node>` とする。ref を使う操作には最新 `snapshotId` を必須とし、navigation・SPA 遷移・所有権移行・60 秒経過で失効させなければならない（SHALL）。

`browser_evaluate` は `snapshotId` と ref を使用せず、観測済み `documentEpoch` を必須としなければならない（SHALL）。配送時には既存 snapshot を失効させなければならない（SHALL）。evaluate 有効時、snapshot は Main が生成した frame 一覧と不透明 `frameId` を返さなければならない（SHALL）。`frameId` は View・所有権・トップ文書・対象 frame の文書世代に結び付け、最大 60 秒で失効させなければならない（SHALL）。

#### Scenario: 古い ref
- **WHEN** 古い snapshot の ref、または意味が変わったノードを操作する
- **THEN** `STALE_REF` を返し、selector で再解決しない

#### Scenario: 古い文書または frame
- **WHEN** evaluate 配送前に指定文書または frame が失効している
- **THEN** `STALE_DOCUMENT` または `STALE_FRAME` を `effect=none` で返し、script を配送しない

#### Scenario: evaluate 後の ref
- **WHEN** evaluate が配送された後に以前の `snapshotId` を使う
- **THEN** `STALE_REF` を返し、新しい snapshot を要求する

### Requirement: 副作用の扱い
副作用があり得る操作は自動再試行してはならず（SHALL NOT）、タイムアウト時は `effect` を `possible` または `applied` として返さなければならない（SHALL）。`browser_evaluate` は読み取り目的を含め、常に副作用があり得る操作として扱わなければならない（SHALL）。配送後の timeout・取消・実行例外・結果変換失敗・結果不明の通信障害は `retryable=false` と `effect=possible` または `applied` を返さなければならず（SHALL）、結果変換失敗を未実行として扱ってはならない（SHALL NOT）。

#### Scenario: クリックのタイムアウト
- **WHEN** click など副作用があり得る操作がタイムアウトする
- **THEN** 操作を自動再試行せず、結果の `effect` を `possible` または `applied` として返し、成否を未確定のまま断定しない

#### Scenario: evaluate の配送後失敗
- **WHEN** evaluate 配送後に成功を確定できない
- **THEN** 自動再試行せず、`effect=possible`・`retryable=false` を返す

#### Scenario: 取消の限界
- **WHEN** 配送済み evaluate を取り消す
- **THEN** 待機と以後の配送を終了する
- **AND** 既に発生したページ変更・通信・サーバー変更を巻き戻したとは報告しない

## ADDED Requirements

### Requirement: ページ世界で JavaScript を評価できる
`browser_evaluate` は、引数なしの async 関数本体として解釈した `script` を、対象 frame のページ自身の JavaScript 環境で実行しなければならない（SHALL）。引数は `leaseId`・`documentEpoch`・`script`（空白のみ不可、16,384 文字かつ UTF-8 16 KiB 以下）・任意の `frameId`・任意の `timeoutMs`（100〜30,000、既定 10,000）とし、追加プロパティは拒否しなければならない（SHALL）。`frameId` 省略時はメインフレームを対象とする。対象 frame の origin は Main が報告する `frame.origin` で HTTP(S) と判定し、それ以外（opaque origin・`data:`・sandbox 付き）では実行してはならない（SHALL NOT）。

#### Scenario: 値の返却
- **WHEN** `return document.title;` を実行する
- **THEN** `{frameId, frameUrl, frameOrigin, value:{type:"json", value:<title>}}` を返す

#### Scenario: 非同期関数本体
- **WHEN** `await` を含む script を実行する
- **THEN** 戻り値の Promise を待ち、解決値を結果とする。`return` がなければ `{type:"undefined"}` とする

#### Scenario: 子 frame の指定
- **WHEN** snapshot が返した `frameId` を指定する
- **THEN** その frame の文書で実行し、結果に対象 frame の情報を含める

#### Scenario: 実行できない frame
- **WHEN** 対象が opaque origin・`data:`・sandbox 付き frame である
- **THEN** 実行せず `effect=none` で拒否する

#### Scenario: 配送中の navigation
- **WHEN** 検査後〜配送の間に対象 frame の navigation が始まる
- **THEN** ページ内ガードが新文書への実行を拒否し、script は実行されない

### Requirement: evaluate の結果を制限された JSON として返す
evaluate の戻り値は、ページ側で制限付きシリアライザにより JSON へ変換し、Main で再検証しなければならない（SHALL）。`null`・boolean・string・有限 number・配列・通常のオブジェクト（`Object.prototype` または null prototype）のみを JSON 値とし、トップレベル `undefined` は `{type:"undefined"}` とする。入れ子の `undefined`・疎な配列・function・symbol・bigint・`NaN`／`Infinity`・DOM node／Window／Event・Date／Map／Set／Error／TypedArray・循環参照・accessor property・symbol key は、シリアライズエラーとしなければならない（SHALL）。独自 `toJSON()` を呼んではならない（SHALL NOT）。結果は UTF-8 64 KiB・深さ 32・値 10,000 個以下とし、超過は `RESULT_TOO_LARGE` として、切り詰めた成功結果を返してはならない（SHALL NOT）。

#### Scenario: 非対応値
- **WHEN** script が Date や循環参照を返す
- **THEN** シリアライズエラーを `retryable=false`・`effect=possible` で返す

#### Scenario: 上限超過
- **WHEN** 結果が 64 KiB・深さ 32・値 10,000 個のいずれかを超える
- **THEN** `RESULT_TOO_LARGE` を返し、部分的な結果は返さない

### Requirement: evaluate の期限と未完了 View を管理する
evaluate は共有 deadline（`timeoutMs`）と取消に従わなければならない（SHALL）。待機は Main の期限と競合させ、ページ側の完了通知に依存してはならない（SHALL NOT）。配送済みで未完了のまま期限・取消・lease 失効に達した場合、Main は対象 View を利用停止して `close({waitForBeforeUnload:false})` し、破棄が確認されるまで新しい View の作成を拒否しなければならない（SHALL）。回復後は同じ partition で新しい View を作成できなければならない（SHALL）。

#### Scenario: 無限ループ
- **WHEN** script が `while(true){}` を実行する
- **THEN** 期限で TIMEOUT（`effect=possible`・`retryable=false`）を返し、View を破棄し、ホストアプリは継続する

#### Scenario: 実行中の取消
- **WHEN** 配送済み evaluate の実行中に HTTP 切断・run 終了・設定 OFF が起きる
- **THEN** 待機を終了し、未完了配送の View を破棄する。キューは回復して次の操作を受け付ける

#### Scenario: 子 frame の無限ループ
- **WHEN** 別プロセスの子 frame で無限ループが起きる
- **THEN** 同様に期限で打ち切り、View 全体を破棄して他の View に影響しない
