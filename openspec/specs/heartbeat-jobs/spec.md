# heartbeat-jobs Specification

## Purpose
TBD - created by archiving change initial-agent-scaffold. Update Purpose after archive.
## Requirements
### Requirement: 固定間隔ハートビート
システムは、Main プロセスで固定間隔のハートビートを実行し、定期処理の起点を提供しなければならない（MUST）。

#### Scenario: 定期 tick が発火する
- **WHEN** アプリが起動してハートビート機能が有効化される
- **THEN** 設定した固定間隔で tick イベントが発火する

### Requirement: 登録ジョブの順次実行
システムは、ハートビート tick ごとに有効な登録ジョブを順次実行しなければならない（MUST）。

#### Scenario: 有効ジョブのみ実行される
- **WHEN** tick 発火時に複数ジョブが登録されている
- **THEN** 有効フラグが true のジョブだけが実行される

### Requirement: ジョブ失敗の隔離
システムは、単一ジョブの失敗によって同一 tick の後続ジョブ実行を停止させてはならない（MUST NOT）。

#### Scenario: 1件失敗しても後続が実行される
- **WHEN** 先頭ジョブが実行中に失敗する
- **THEN** システムは失敗を記録し、後続ジョブの実行を継続する

