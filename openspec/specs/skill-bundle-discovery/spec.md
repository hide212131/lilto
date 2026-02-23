# skill-bundle-discovery Specification

## Purpose
TBD - created by archiving change agent-browser-skill. Update Purpose after archive.
## Requirements
### Requirement: アプリ専用ディレクトリのスキル発見
システムはアプリ専用ディレクトリに配置されたスキルを発見しなければならない（SHALL）。

#### Scenario: アプリ専用ディレクトリの検出
- **WHEN** スキル探索が実行される
- **THEN** `<app data>/skills` が探索対象に含まれる

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

