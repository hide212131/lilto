# skills-library-list-and-remove Specification

## Purpose
 lilto から管理する Codex skill の一覧取得と削除の振る舞いを定義する。

## Requirements
### Requirement: 一貫した skill 一覧
アプリは、workspace ローカルな Codex skill について `skills` ライブラリの管理状態と整合した一覧を返さなければならず（SHALL）、一覧には少なくとも skill 名、source 種別、参照可能なパスを含めなければならない（MUST）。

#### Scenario: 一覧取得が成功する
- **WHEN** ユーザーが Agent Skills 一覧を要求する
- **THEN** アプリは `skills` ライブラリの状態と bundled skill を合わせた整合的な一覧を返す

#### Scenario: symlink 形式の workspace skill が存在する
- **WHEN** `<workspace>/.agents/skills` 配下に symlink 形式の skill が存在する
- **THEN** その skill は `source=user` として一覧に含まれる

### Requirement: user skill のみ削除する
アプリは、workspace ローカル skill を削除するとき `skills` ライブラリの管理境界を尊重しなければならず（MUST）、bundled または system skill を削除対象として扱ってはならない（MUST NOT）。

#### Scenario: user skill を削除する
- **WHEN** ユーザーが workspace ローカルな user skill を削除する
- **THEN** その skill は削除され、次回ランタイム更新に変更が反映される

#### Scenario: bundled skill の削除を拒否する
- **WHEN** ユーザーが bundled または system skill の削除を試みる
- **THEN** アプリはその要求を拒否し、エラーを返す

### Requirement: エラー伝播
アプリは、一覧取得と削除の失敗を UI へ伝播しなければならない（SHALL）。

#### Scenario: 一覧取得失敗
- **WHEN** I/O または `skills` ライブラリ由来の理由で一覧取得が失敗する
- **THEN** UI はエラーメッセージ付きの失敗結果を受け取る

#### Scenario: 削除失敗
- **WHEN** I/O または `skills` ライブラリ由来の理由で削除処理が失敗する
- **THEN** UI はエラーメッセージ付きの失敗結果を受け取る
