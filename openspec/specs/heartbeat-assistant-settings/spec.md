# heartbeat-assistant-settings Specification

## Purpose
TBD - created by archiving change add-heartbeat-assistant-patrol. Update Purpose after archive.
## Requirements
### Requirement: Settings から heartbeat assistant の基本設定を保存できる
システムは、Settings から heartbeat assistant の有効化状態、`HEARTBEAT.md` の参照先、cadence などの基本設定を保存し、次回起動後も同じ設定を復元しなければならない（MUST）。

#### Scenario: heartbeat assistant を有効化して保存する
- **WHEN** ユーザーが Settings で heartbeat assistant を有効化し、参照先 `HEARTBEAT.md` と cadence を保存する
- **THEN** システムは設定を永続化し、次回起動後も同じ設定を復元する

#### Scenario: heartbeat assistant を無効化して保存する
- **WHEN** ユーザーが Settings で heartbeat assistant を無効化して保存する
- **THEN** システムは無効化状態を永続化し、巡回を開始しない

### Requirement: Settings は heartbeat assistant の設定異常を区別して表示できる
システムは、`HEARTBEAT.md` の参照先が未設定、存在しない、または読めない場合、成功状態や空状態と区別できる設定状態を表示しなければならない（MUST）。設定異常時に heartbeat assistant が正常稼働しているように見せてはならない（MUST NOT）。

#### Scenario: 参照先未設定を表示する
- **WHEN** heartbeat assistant を有効化したが `HEARTBEAT.md` の参照先が未設定である
- **THEN** システムは未設定であることを Settings 内へ表示する

#### Scenario: 読み取れない参照先を表示する
- **WHEN** 保存済み `HEARTBEAT.md` の参照先が存在しない、または読み取りに失敗する
- **THEN** システムは設定異常として扱い、成功状態と区別して表示する

### Requirement: heartbeat assistant 設定は user schedule 管理と分離して表示される
システムは、heartbeat assistant の設定導線を user が管理する通常の schedule 一覧と分離して表示しなければならない（MUST）。heartbeat assistant を通常の schedule 一覧の1件としてしか認識できない UI にしてはならない（MUST NOT）。

#### Scenario: heartbeat assistant が独立した設定導線で表示される
- **WHEN** ユーザーが Settings を開く
- **THEN** システムは user schedule 管理とは別に heartbeat assistant の設定導線を表示する

