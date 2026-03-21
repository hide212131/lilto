# skill-authoring-assistant Specification

## Purpose
 lilto がユーザー作成 skill をどのように生成し、永続化するかを定義する。

## Requirements
### Requirement: `skill-creator` の優先利用
アプリは、ユーザーが skill 作成を求めたとき、bundled の `skill-creator` フローを優先して利用しなければならない（SHALL）。

#### Scenario: skill 作成依頼
- **WHEN** ユーザーが skill の作成を依頼する
- **THEN** アプリはその依頼を `skill-creator` 経由で処理できる

#### Scenario: 明示的な skill ファイル作成
- **WHEN** ユーザーが `/skill:<name>` を手動で作成するよう依頼する
- **THEN** アプリは要求された skill 構造を直接作成できる

### Requirement: 生成した skill を workspace に保存する
アプリは、生成した skill を現在の workspace に永続化し、Codex が起動ディレクトリから検出できるようにしなければならない（MUST）。

#### Scenario: 生成 skill の保存
- **WHEN** `skill-creator` またはアプリが新しい skill を作成する
- **THEN** 生成物には `<workspace>/.agents/skills/<skill-name>/SKILL.md` が含まれる

#### Scenario: 次回起動時の再検出
- **WHEN** アプリが同じ workspace で再起動する
- **THEN** `<workspace>/.agents/skills` 配下の既存 skill が再び一覧に含まれる
