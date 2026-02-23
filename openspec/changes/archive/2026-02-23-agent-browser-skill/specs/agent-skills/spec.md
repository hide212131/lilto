## ADDED Requirements

### Requirement: Skill のメタデータ定義
各 Skill は agentskills.io 仕様と互換性のある `name`・`description`・`parameters` を JSON で返さなければならない（SHALL）。さらに、SKILL.md の frontmatter から `name`・`description`・`parameters` を取得できなければならない（SHALL）。

#### Scenario: メタデータの取得
- **WHEN** Skill のメタデータ取得メソッドが呼び出される
- **THEN** 有効な JSON 形式で `name`・`description`・`parameters` が返される

#### Scenario: SKILL.md からのメタデータ読み込み
- **WHEN** SKILL.md が存在する Skill を読み込む
- **THEN** frontmatter から `name`・`description`・`parameters` が取得される

### Requirement: Skill レジストリへの静的登録
Skill はアプリ起動時にレジストリへ静的登録されなければならない（SHALL）。ただし、SKILL.md ベースのスキルは起動時に一覧化され、実行時にオンデマンドで読み込まれなければならない（SHALL）。

#### Scenario: 登録済み Skill の実行
- **WHEN** AI エージェントが登録済み Skill 名を呼び出す
- **THEN** 対応する Skill の `execute()` が呼び出され、結果が返される

#### Scenario: SKILL.md スキルの一覧化
- **WHEN** 起動時にスキル一覧が作成される
- **THEN** SKILL.md ベースのスキルが一覧に含まれる

#### Scenario: オンデマンド読み込み
- **WHEN** SKILL.md ベースのスキルが実行要求される
- **THEN** 実体が読み込まれて実行される
