# skill-authoring-assistant Specification

## Purpose
TBD - created by archiving change add-bundled-skill-creator-skill. Update Purpose after archive.
## Requirements
### Requirement: スキル化依頼時の `skill-creator` 優先選択
システムは、ユーザー入力がスキル作成・再利用化を要求する意図を含む場合、`skill-creator` を優先して選択しなければならない（SHALL）。

#### Scenario: スキル化依頼の自動優先
- **WHEN** ユーザーが「この手順をスキルにして」などの依頼を送信する
- **THEN** 実行入力は `skill-creator` を使う形に補正される

#### Scenario: 明示スキル指定の尊重
- **WHEN** ユーザー入力が `/skill:<name>` で明示指定されている
- **THEN** システムは自動補正を行わず明示指定を優先する

### Requirement: 生成スキルの永続保存
システムは、`skill-creator` が生成したスキルを次回セッションで再利用可能な永続領域に保存しなければならない（MUST）。

#### Scenario: 生成スキルの保存先
- **WHEN** `skill-creator` が新規スキルを生成する
- **THEN** 生成物は `~/.pi/skills/<skill-name>/SKILL.md` を含む構造で保存される

#### Scenario: 次回起動での再発見
- **WHEN** アプリを再起動してスキル一覧を生成する
- **THEN** 前回作成した `~/.pi/skills` 配下のスキルが一覧に含まれる

