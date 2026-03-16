# skill-bundle-discovery Specification

## Purpose
TBD - created by archiving change agent-browser-skill. Update Purpose after archive.
## Requirements
### Requirement: アプリ専用ディレクトリのスキル発見
システムは、組み込みスキル用ディレクトリとユーザー生成スキル用ディレクトリの両方に配置されたスキルを発見しなければならない（SHALL）。

#### Scenario: 組み込みスキルディレクトリの検出
- **WHEN** スキル探索が実行される
- **THEN** `<CODEX_HOME>/skills/.system` が探索対象に含まれる

#### Scenario: ユーザー生成スキルディレクトリの検出
- **WHEN** スキル探索が実行される
- **THEN** `<app userData>/.agents/skills` が探索対象に含まれる

#### Scenario: 同名スキルの優先順
- **WHEN** `<CODEX_HOME>/skills/.system` と `<app userData>/.agents/skills` に同名スキルが存在する
- **THEN** `<app userData>/.agents/skills` 側のスキルが優先される

### Requirement: SKILL.md のメタデータ読み込み
システムは発見したスキルの SKILL.md からメタデータを読み込まなければならない（SHALL）。

#### Scenario: メタデータの取得
- **WHEN** スキル一覧が取得される
- **THEN** SKILL.md の frontmatter から `name`・`description`・`parameters` が読み込まれる

### Requirement: スキル一覧の提示
システムは発見したスキルを一覧として提示しなければならない（SHALL）。

#### Scenario: 一覧表示
- **WHEN** スキル一覧が要求される
- **THEN** 発見済みスキルが名前と説明付きで返される
