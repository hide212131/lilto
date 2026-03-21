# gui-change-e2e-completion-gate Specification

## Purpose
TBD - created by archiving change add-electron-agent-browser-e2e-gate. Update Purpose after archive.
## Requirements
### Requirement: GUI 変更タスクの完了には E2E 実施が必須である
システムは GUI 変更を含むタスクに対して、E2E 実施結果の確認なしに完了として扱ってはならない（MUST NOT）。

#### Scenario: GUI 変更で E2E 未実施の場合
- **WHEN** タスクが GUI 変更を含むにもかかわらず E2E 実行記録がない
- **THEN** タスクは完了条件を満たさず、完了報告できない

### Requirement: GUI 変更タスクの完了前に live UI 検証を行う
システムは GUI 変更を含むタスクに対して、最終 E2E の前に `live-ui-manual-verification` を使ったライブ UI 検証を実施しなければならない（MUST）。

#### Scenario: まず障害解析と機能確認を行う場合
- **WHEN** 開発者が GUI 変更タスクの完了可否を確認する
- **THEN** `live-ui-manual-verification` を先に実施し、その後に最終 E2E を行う

### Requirement: 完了条件ルールが明文化されている
システムは開発規約（`AGENTS.md`）に、GUI 変更時の E2E 必須ルールを明記しなければならない（MUST）。

#### Scenario: 完了前チェックでルール参照ができる
- **WHEN** 開発者またはレビュアーが GUI 変更タスクの完了可否を確認する
- **THEN** `AGENTS.md` の完了前検証に E2E 必須ルールが記載され、判断基準として参照できる
