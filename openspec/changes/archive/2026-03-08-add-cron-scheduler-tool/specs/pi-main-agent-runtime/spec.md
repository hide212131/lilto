## ADDED Requirements

### Requirement: Main プロセスは scheduler daemon を起動監視できる
システムは、Electron Main プロセス起動時に scheduler daemon を初期化し、コマンド送信とイベント受信が可能な状態を維持しなければならない（MUST）。daemon が異常終了した場合、Main は障害を観測し、エージェント実行と通知機能が扱えるエラーとして表面化しなければならない（MUST）。

#### Scenario: アプリ起動時に scheduler daemon が利用可能になる
- **WHEN** lilto の Main プロセスが起動する
- **THEN** システムは scheduler daemon を起動し、ready 状態を確認してから scheduler API を受け付ける

#### Scenario: daemon 異常終了を検知する
- **WHEN** scheduler daemon が実行中に異常終了する
- **THEN** システムはその失敗をログとエラー応答で観測可能にする

### Requirement: Main プロセスは cron custom tool を agent runtime に公開する
システムは、Pi SDK のエージェント実行中に `cron` custom tool を利用可能にしなければならない（MUST）。tool 実行結果は通常のツール実行イベントと同様に Renderer へ中継されなければならない（MUST）。

#### Scenario: AI が高水準 operation で timer を登録する
- **WHEN** エージェント実行中に AI が `cron` tool の `set_timer` を呼び出す
- **THEN** Main はその入力を scheduler daemon 用の one-shot schedule に正規化し、結果を tool 実行結果として AI に返す

#### Scenario: AI が低水準 operation で複雑な schedule を登録する
- **WHEN** エージェント実行中に AI が `cron` tool の `create` または `update` を呼び出す
- **THEN** Main は与えられた `runAt` または `cronExpr` をそのまま scheduler daemon へ転送し、結果を tool 実行結果として AI に返す

#### Scenario: cron tool の失敗が標準化される
- **WHEN** `cron` tool の入力不正または scheduler daemon エラーが発生する
- **THEN** Main はエラーコードと説明を含む失敗結果を返し、Renderer にも失敗イベントを中継する

### Requirement: scheduler 発火イベントを対象セッションへ配送できる
システムは、scheduler daemon から発火イベントを受信したとき、payload に含まれる `sessionId` を解決して対象チャットへ通知を追加しなければならない（MUST）。また、アプリが非フォーカス時は OS 通知と未読バッジも更新しなければならない（MUST）。

#### Scenario: 発火イベントが対象チャットへ反映される
- **WHEN** Main が scheduler daemon から有効な `sessionId` を持つ発火イベントを受信する
- **THEN** システムは対象 session のチャットへ通知メッセージを追加する

#### Scenario: 非フォーカス時にデスクトップ通知も出る
- **WHEN** scheduler 発火時にアプリウィンドウが非フォーカス状態である
- **THEN** システムはチャット反映に加えてデスクトップ通知と未読バッジ更新を行う

### Requirement: Main プロセスは scheduler follow-up 情報を Renderer へ渡せる
システムは、scheduler 発火イベントに follow-up 指示が含まれる場合、その情報を Renderer が同一会話で follow-up 実行に使える形で中継しなければならない（MUST）。

#### Scenario: follow-up 指示があれば Renderer へ同梱して中継する
- **WHEN** Main が `followUpInstruction` を含む scheduler 発火イベントを受信する
- **THEN** システムは対象 session へ送る scheduler 通知イベントに `followUpInstruction` を含めて Renderer へ中継する

#### Scenario: Renderer 起点 follow-up の loop event が通常応答と同様に中継される
- **WHEN** Renderer が scheduler follow-up として `submitPrompt` を呼び出し AI が tool を実行する
- **THEN** Main はその loop event と最終応答を通常のエージェント実行と同じ経路で Renderer へ中継する
