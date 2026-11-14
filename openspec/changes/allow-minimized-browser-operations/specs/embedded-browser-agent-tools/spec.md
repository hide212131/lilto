## MODIFIED Requirements

### Requirement: 実行単位の capability と所有権
認証は run ごとの token によってのみ行い、body の自己申告を根拠にしてはならない（SHALL NOT）。別 run／別会話／ユーザーが所有中の acquire は `BROWSER_BUSY` としなければならない（SHALL）。evaluate を含むページ操作は、配送直前に有効な lease・操作環境（明示的に hide されていない・画面ロック／suspend でない・モーダルやリサイズ中でない）・権限設定を検証しなければならない（SHALL）。ウィンドウの最小化・OS フォーカスの有無・他ウィンドウによる遮蔽は、操作の拒否条件にしてはならない（SHALL NOT）。

#### Scenario: 失効
- **WHEN** ユーザーの手動切替・パネルを閉じる・明示的な hide・画面ロック・OS suspend・設定 OFF・run 終了・中断が起きる
- **THEN** lease を失効し、待機中・キュー中の操作を取り消し、以後のツール配送を禁止する
- **AND** 配送済み evaluate が未完了なら対象 View を利用停止し、閉じる

#### Scenario: 最小化・非フォーカス・遮蔽
- **WHEN** ウィンドウが最小化される、他アプリが前面でフォーカスを持つ、または他ウィンドウが完全に覆っている
- **THEN** lease・View・レイアウト・epoch を維持し、全ツール（evaluate を含む）を配送できる
- **AND** 別 run の acquire は `BROWSER_BUSY` のままである

#### Scenario: 一時的な遮蔽
- **WHEN** アプリ内モーダル表示またはリサイズが始まる
- **THEN** ページ操作を中断し、`PANEL_OCCLUDED` を返し、新しい有効な表示測定までは配送しない
- **AND** 未完了の evaluate が配送済みなら対象 View と lease を失効させる

#### Scenario: 画面ロックと suspend
- **WHEN** 画面ロックまたは OS suspend を検知する
- **THEN** 以後の配送を `SYSTEM_LOCKED`／`SYSTEM_SUSPENDED` で拒否し、lease を失効する
- **AND** 解除・復帰後も旧 lease や途中の操作を再開しない

### Requirement: 操作状態の報告とエラーコード
tool 結果の `state` と `browser_status` は、`panelVisible`（View がユーザーに見える状態）とは別に `operationReady`（ツールが操作できる状態）と `windowMinimized` を返さなければならない（SHALL）。最小化中の準備済みパネルでは `panelVisible=false` かつ `operationReady=true` としなければならない（SHALL）。`BROWSER_UNAVAILABLE` は明示的に hide された・ウィンドウが存在しない・終了処理中にのみ返し、最小化では返してはならない（SHALL NOT）。`browser_release` は操作が禁止されている間も所有権を解放できなければならない（SHALL）。

#### Scenario: autoOpen
- **WHEN** パネルが閉じている状態で、最小化中に acquire する
- **AND** autoOpen が有効である
- **THEN** ウィンドウを復帰せずにパネルを論理的に開き、有効な測定が得られたら操作可能にする。期限内に得られなければ `PANEL_NOT_READY`・`effect=none` を返す

#### Scenario: autoOpen 無効
- **WHEN** パネルが閉じている状態で autoOpen が無効である
- **THEN** `PANEL_CLOSED` を返し、何も配送しない

#### Scenario: 副作用の可能性がある中断
- **WHEN** 配送後に環境ゲートが閉じる
- **THEN** それまでの `effect` を保持し、`retryable` を付けない

### Requirement: 背景実行と screenshot
AI がブラウザを所有している間は、ページ面とホスト renderer の background throttling を無効化し、所有の終了・失効で復元しなければならない（SHALL）。OS のスリープを止める `powerSaveBlocker` を使用してはならない（SHALL NOT）。`browser_screenshot` は現在のページ面だけを返さなければならず（SHALL）、古い画像の代用やウィンドウの自動復帰をしてはならない（SHALL NOT）。ページがフレームを生成していない・取得に失敗した・空画像の場合は `SCREENSHOT_UNAVAILABLE` を返さなければならない（SHALL）。

#### Scenario: 最小化後の screenshot
- **WHEN** 最小化前に描画済みの文書に対して、最小化中に screenshot を呼ぶ
- **THEN** 最小化後に変更した内容を反映した現在の画像を返す

#### Scenario: 最小化中に読み込んだ文書
- **WHEN** 最小化中に新たに読み込んだ文書（初回 acquire・navigate など）に対して screenshot を呼ぶ
- **AND** ページがフレームを生成していない
- **THEN** `SCREENSHOT_UNAVAILABLE` を返し、古い画像を返さない
