## MODIFIED Requirements

### Requirement: アプリ専用ディレクトリのスキル発見
システムは、組み込みスキル用ディレクトリとユーザー生成スキル用ディレクトリの両方に配置されたスキルを発見しなければならない（SHALL）。

#### Scenario: 組み込みスキルディレクトリの検出
- **WHEN** スキル探索が実行される
- **THEN** `<app data>/skills/bundled` が探索対象に含まれる

#### Scenario: ユーザー生成スキルディレクトリの検出
- **WHEN** スキル探索が実行される
- **THEN** `~/.pi/skills` が探索対象に含まれる

#### Scenario: 同名スキルの優先順
- **WHEN** `<app data>/skills/bundled` と `~/.pi/skills` に同名スキルが存在する
- **THEN** `~/.pi/skills` 側のスキルが優先される
