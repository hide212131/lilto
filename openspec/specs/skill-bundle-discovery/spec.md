# skill-bundle-discovery Specification

## Purpose
 lilto が Codex 互換 skill をどこから検出するかを定義する。

## Requirements
### Requirement: Skill 検出ルート
アプリは、Codex が期待する配置に従って bundled skill と workspace ローカル skill を検出しなければならない（SHALL）。

#### Scenario: bundled skill の検出
- **WHEN** skill 検出が実行される
- **THEN** `<CODEX_HOME>/skills/.system` が探索ルートに含まれる

#### Scenario: workspace user skill の検出
- **WHEN** skill 検出が実行される
- **THEN** `<workspace>/.agents/skills` が探索ルートに含まれる

#### Scenario: 同名 skill が両方に存在する
- **WHEN** `<CODEX_HOME>/skills/.system` と `<workspace>/.agents/skills` の両方に同じ `name` の skill が存在する
- **THEN** アプリ表示上は `<workspace>/.agents/skills` 側の skill が優先される

### Requirement: `SKILL.md` メタデータの読み込み
アプリは、skill のメタデータを `SKILL.md` の frontmatter から読み込まなければならない（SHALL）。

#### Scenario: メタデータ抽出
- **WHEN** skill が検出される
- **THEN** frontmatter から少なくとも `name`、`description`、`parameters` が読み込まれる

### Requirement: Skill 一覧表示
アプリは、検出した skill を単一の一覧として提示しなければならない（SHALL）。

#### Scenario: 検出済み skill を一覧表示する
- **WHEN** ユーザーが skill 一覧を開く
- **THEN** bundled skill と workspace ローカル skill が、重複名なしの単一一覧として表示される
