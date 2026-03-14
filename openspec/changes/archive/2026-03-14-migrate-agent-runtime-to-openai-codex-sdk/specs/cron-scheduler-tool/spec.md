## MODIFIED Requirements

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
