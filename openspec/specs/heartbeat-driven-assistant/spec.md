# heartbeat-driven-assistant Specification

## Purpose
TBD - created by archiving change add-heartbeat-assistant-patrol. Update Purpose after archive.
## Requirements
### Requirement: heartbeat assistant は `HEARTBEAT.md` を手順書として定期巡回を実行できる
システムは、有効化された heartbeat assistant に対して保存済み設定の cadence で定期巡回を実行し、その都度 `HEARTBEAT.md` を読んで巡回手順を解釈しなければならない（MUST）。`HEARTBEAT.md` が空の場合、システムは巡回用のモデル実行を行ってはならない（MUST NOT）。

#### Scenario: 有効な `HEARTBEAT.md` を使って巡回する
- **WHEN** heartbeat assistant が有効で、参照先 `HEARTBEAT.md` に巡回手順が保存されている
- **THEN** システムは cadence ごとに当該ファイルを読み、巡回実行を開始する

#### Scenario: 空の `HEARTBEAT.md` ではモデル実行をスキップする
- **WHEN** heartbeat assistant が有効だが、参照先 `HEARTBEAT.md` が空である
- **THEN** システムは巡回用のモデル実行を行わず、静かに終了する

### Requirement: heartbeat assistant は state と instruction source を分離しなければならない
システムは、heartbeat assistant の巡回 instruction を `HEARTBEAT.md` に保持し、前回巡回状態と通知履歴を `heartbeat_state.json` 互換の state ファイルへ分離して保持しなければならない（MUST）。instruction source と runtime state を同じファイルへ混在させてはならない（MUST NOT）。

#### Scenario: state file に lastChecks と通知履歴を保持する
- **WHEN** heartbeat assistant が巡回を実行する
- **THEN** システムは `lastChecks` と通知履歴を state file へ保持する

#### Scenario: 既存 state file を互換読込する
- **WHEN** 旧形式の heartbeat state file が残っている
- **THEN** システムは現在の state 構造へ正規化して扱う

### Requirement: heartbeat assistant は `HEARTBEAT_OK` を user-facing に表面化してはならない
システムは、heartbeat assistant の巡回結果が `HEARTBEAT_OK` のみである場合、その結果を user-facing session や通知へ表面化してはならない（MUST NOT）。対応が必要な finding がある場合だけ、既存の通知経路へ表面化しなければならない（MUST）。

#### Scenario: 問題なしの巡回は静かに終了する
- **WHEN** 巡回結果が `HEARTBEAT_OK` のみである
- **THEN** システムは user-facing session や通知を追加せず、静かに終了する

#### Scenario: 対応が必要な finding だけを表面化する
- **WHEN** 巡回結果に要対応の報告が含まれる
- **THEN** システムは finding を短い報告として既存の通知経路へ反映する

### Requirement: heartbeat assistant は report-only で動作しなければならない
システムは、heartbeat assistant の巡回から送信、削除、購入などの確定操作を自動実行してはならない（MUST NOT）。巡回結果は状況報告に限定しなければならない（MUST）。

#### Scenario: 巡回で確定操作を実行しない
- **WHEN** heartbeat assistant が外部サービスへ書き込み可能な状況で巡回を実行する
- **THEN** システムは確定操作を実行せず、必要なら状況報告だけを返す

### Requirement: heartbeat assistant は重複通知を抑制しなければならない
システムは、前回までに通知済みの finding を state と比較し、同一内容を短時間に繰り返し通知してはならない（MUST NOT）。duplicate suppression には stable key を優先して使い、stable key を得られない場合だけ normalized response にフォールバックしなければならない（MUST）。finding の内容または状態が変化した場合は、再度通知できなければならない（MUST）。

#### Scenario: stable key で同一 finding を抑制する
- **WHEN** 前回通知した finding と同じ stable key が再度検出される
- **THEN** システムは同じ finding を再通知しない

#### Scenario: stable key が取れない場合は normalized response へフォールバックする
- **WHEN** runtime から stable key を抽出できない
- **THEN** システムは normalized response を duplicate suppression key として扱う

#### Scenario: 状態変化した finding を再通知する
- **WHEN** 既知の finding でも内容または状態が変化している
- **THEN** システムは新しい finding として再通知する

