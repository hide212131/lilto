# cron-scheduler-tool Specification

## Purpose
AI が会話の中でスケジュールを管理し、指定時刻や繰り返し時刻にチャットへ通知を返す capability の要件を定義します。

## Requirements
### Requirement: AI は MCP 経由の高水準 cron tool API を優先してスケジュールを操作できる
システムは、Pi の Custom Tool ではなく Codex runtime から接続された MCP server 経由で `cron` tool を提供し、AI が頻出ケースでは高水準 operation を使ってスケジュール登録できなければならない（MUST）。高水準 operation は AI に cron 式や RFC3339 の直接生成を要求してはならない（MUST NOT）。各操作は構造化引数で受け付け、成功時には schedule ID と確定した実行条件を返さなければならない（MUST）。

#### Scenario: 相対時間のタイマーを登録する
- **WHEN** Codex runtime が接続した MCP server 上の `cron` tool に AI が `set_timer` operation と `afterSeconds` を含む登録要求を送る
- **THEN** システムは schedule を保存し、schedule ID と確定した実行時刻を返す

#### Scenario: 毎日通知を登録する
- **WHEN** Codex runtime が接続した MCP server 上の `cron` tool に AI が `set_daily_reminder` operation と `hour` / `minute` / `timezone` を含む登録要求を送る
- **THEN** システムは日次 recurring schedule を保存し、schedule ID と確定した cron 条件を返す

#### Scenario: 指定日時の通知を登録する
- **WHEN** Codex runtime が接続した MCP server 上の `cron` tool に AI が `set_reminder_at` operation と `date` / `time` / `timezone` を含む登録要求を送る
- **THEN** システムは tool 内で RFC3339 に正規化した one-shot schedule を保存し、schedule ID と確定した実行時刻を返す

#### Scenario: 既存スケジュールを一覧する
- **WHEN** Codex runtime が接続した MCP server 上の `cron` tool に一覧要求を送る
- **THEN** システムは有効なスケジュールの ID、種別、次回実行時刻、通知先情報を返す

#### Scenario: 複雑な繰り返しは低水準 API で登録する
- **WHEN** AI が高水準 operation では表現できない schedule を登録する必要がある
- **THEN** システムは低水準 `create` / `update` operation により `runAt` または `cronExpr` を直接受け付ける

#### Scenario: 既存スケジュールを変更または削除する
- **WHEN** Codex runtime が接続した MCP server 上の `cron` tool に AI が既存 schedule ID を指定して更新または削除要求を送る
- **THEN** システムは対象 schedule を更新または無効化し、反映後の状態を返す

### Requirement: スケジュールは通知先セッション情報を保持する
システムは、登録される各スケジュールに通知先 `sessionId` と完了メッセージを保存しなければならない（MUST）。発火後に AI が続けて実行すべき処理がある場合は、その follow-up 指示も保存できなければならない（MUST）。通知先のない schedule を受け付けてはならない（MUST NOT）。

#### Scenario: 通知先付きで登録される
- **WHEN** AI が `sessionId` と完了メッセージを含むスケジュール登録を行う
- **THEN** システムはその payload を schedule 定義と一緒に永続化する

#### Scenario: follow-up 指示付きで登録される
- **WHEN** AI が発火後に実行すべき follow-up 指示を含むスケジュール登録を行う
- **THEN** システムはその follow-up 指示を schedule payload に保持する

#### Scenario: 通知先が欠けている登録を拒否する
- **WHEN** AI が `sessionId` または完了メッセージを欠いた schedule 登録を行う
- **THEN** システムは登録を拒否し、入力不足を示すエラーを返す

### Requirement: 期限到来時に対象チャットへ通知できる
システムは、スケジュール発火時に保存済み `sessionId` を解決し、対象チャットへ完了通知を配送しなければならない（MUST）。one-shot 実行後は同一 schedule を再実行してはならない（MUST NOT）。

#### Scenario: one-shot タイマー完了をチャットへ通知する
- **WHEN** one-shot schedule の実行時刻に到達する
- **THEN** システムは対象 session のチャットに完了メッセージを通知する

#### Scenario: 繰り返し schedule が次回以降も継続する
- **WHEN** recurring schedule が1回発火する
- **THEN** システムは当該回の通知を配送し、次回実行予定を維持する

### Requirement: follow-up 指示があれば AI が通知後の処理を継続できる
システムは、schedule 発火イベントに follow-up 指示が含まれる場合、通知文言とともにその指示を agent runtime へ渡し、同一会話で後続処理を継続できなければならない（MUST）。

#### Scenario: 通知後に URL を開く follow-up を実行する
- **WHEN** `followUpInstruction` に「alpha.co.jp を開きます」のような指示を持つ schedule が発火する
- **THEN** システムは対象チャットへ通知を追加した上で、AI がその指示に従って後続の tool 実行を行えるよう同一会話で follow-up 実行を開始する

#### Scenario: follow-up 指示がない場合は通知のみで終わる
- **WHEN** `followUpInstruction` を持たない schedule が発火する
- **THEN** システムは通知文言のみをチャットへ追加し、自動の follow-up 実行は行わない

### Requirement: スケジュールはアプリ再起動後も復元される
システムは、有効なスケジュール定義を永続化し、アプリ再起動後に再登録しなければならない（MUST）。

#### Scenario: アプリ再起動後に one-shot 予定が残る
- **WHEN** ユーザーが one-shot schedule 登録後にアプリを再起動する
- **THEN** システムは未実行 schedule を復元し、予定時刻に通知できる

#### Scenario: アプリ再起動後に recurring 予定が残る
- **WHEN** ユーザーが recurring schedule 登録後にアプリを再起動する
- **THEN** システムは recurring schedule を復元し、次回以降の実行を継続する
