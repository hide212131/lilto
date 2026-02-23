## ADDED Requirements

### Requirement: Electron GUI を agent-browser で E2E 検証できる
システムは `agent-browser` を利用して Electron アプリの主要 GUI フローを E2E として実行できなければならない（MUST）。

#### Scenario: 最小スモークフローを実行できる
- **WHEN** 開発者が定義済みの E2E 実行手順で `agent-browser` シナリオを実行する
- **THEN** Electron アプリの起動、主要操作、正常終了を自動で検証できる

### Requirement: E2E 実行結果を確認可能である
システムは E2E 実行の成功/失敗を判定できるログまたは結果出力を提供しなければならない（MUST）。

#### Scenario: E2E が失敗した場合に判別できる
- **WHEN** GUI 操作のいずれかが期待結果と一致しない
- **THEN** 実行結果から失敗箇所を識別でき、成功扱いにならない
