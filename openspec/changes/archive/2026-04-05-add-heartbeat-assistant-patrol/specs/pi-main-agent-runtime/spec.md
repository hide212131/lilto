## ADDED Requirements

### Requirement: Main プロセスは heartbeat assistant の background patrol を実行できる
システムは、Renderer の通常送信とは独立して、Main プロセスから heartbeat assistant 用の background patrol を開始できなければならない（MUST）。この patrol 実行は `HEARTBEAT.md` と軽量な巡回コンテキストを使い、通常会話のフル履歴を前提にしてはならない（MUST NOT）。

#### Scenario: internal schedule 発火で background patrol を開始する
- **WHEN** heartbeat assistant 用の internal schedule が発火する
- **THEN** システムは Main プロセスから background patrol を開始する

#### Scenario: patrol は軽量コンテキストで実行される
- **WHEN** heartbeat assistant の background patrol を実行する
- **THEN** システムは `HEARTBEAT.md` と巡回に必要な最小コンテキストを使って runtime を実行する

### Requirement: Main プロセスは heartbeat assistant の結果を通知経路へ反映できる
システムは、heartbeat assistant の巡回結果が actionable finding である場合だけ、既存の通知経路を使ってユーザーへ結果を表面化できなければならない（MUST）。`HEARTBEAT_OK` や duplicate suppression の結果を通知経路へ流してはならない（MUST NOT）。アプリが非フォーカス状態なら、OS 通知も利用できなければならない（MUST）。

#### Scenario: finding を履歴または通知へ反映する
- **WHEN** heartbeat assistant の巡回結果に要対応の finding が含まれる
- **THEN** システムは既存の通知経路を通して結果を表面化する

#### Scenario: HEARTBEAT_OK は通知しない
- **WHEN** heartbeat assistant の巡回結果が `HEARTBEAT_OK` のみである
- **THEN** システムは既存の通知経路へ event を流さない

#### Scenario: 非フォーカス時は OS 通知も使う
- **WHEN** heartbeat assistant の巡回結果を表面化する時点でアプリが非フォーカスである
- **THEN** システムは通常の反映に加えて OS 通知も行う

### Requirement: Main プロセスは heartbeat assistant state を runtime prompt へ渡せる
システムは、heartbeat assistant の background patrol を開始するとき、`heartbeat_state.json` 相当の state を runtime prompt へ渡せなければならない（MUST）。prompt では stable key と check name を返しやすい形式を要求できなければならない（MUST）。

#### Scenario: state を参照して background patrol を実行する
- **WHEN** Main プロセスが heartbeat assistant の巡回を開始する
- **THEN** システムは state を prompt へ渡して runtime を実行する

#### Scenario: stable key を返すフォーマットを prompt で要求する
- **WHEN** Main プロセスが heartbeat assistant の巡回 prompt を組み立てる
- **THEN** システムは stable key と check name を返すフォーマットを prompt に含める