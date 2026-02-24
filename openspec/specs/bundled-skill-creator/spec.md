# bundled-skill-creator Specification

## Purpose
TBD - created by archiving change add-bundled-skill-creator-skill. Update Purpose after archive.
## Requirements
### Requirement: `skill-creator` の組み込み提供
システムは、`skill-creator` を組み込みスキルとして配布しなければならない（SHALL）。

#### Scenario: 組み込み一覧への表示
- **WHEN** 起動時にスキル一覧が作成される
- **THEN** `skill-creator` が一覧に含まれる

### Requirement: 組み込みスキル配置の分離
システムは、組み込みスキルをユーザー生成スキルとは分離したディレクトリに配置しなければならない（MUST）。

#### Scenario: 配置先の検証
- **WHEN** 組み込みスキルが展開される
- **THEN** `skill-creator` は `<app data>/skills/bundled/skill-creator/SKILL.md` に配置される

#### Scenario: Pi 設定への登録
- **WHEN** スキルランタイムの初期化が実行される
- **THEN** Pi 設定の `skills` 配列に `<app data>/skills/bundled` が登録される

