# skills-library-list-and-remove Specification

## Purpose
TBD - synced from change extend-skill-management-list-and-delete-via-skills-library.

## Requirements
### Requirement: Skills ライブラリ準拠の一覧取得
アプリは Skill 一覧を取得する際、`skills` ライブラリ管理状態と整合した結果を返さなければならない（SHALL）。一覧には少なくとも Skill 名・ソース種別（bundled/user）・参照可能な Skill 定義パスを含めなければならない（MUST）。

#### Scenario: 一覧取得が成功する
- **WHEN** ユーザーが Agent Skills の一覧表示を要求する
- **THEN** `skills` ライブラリ管理状態と矛盾しない Skill 一覧が返される

#### Scenario: symlink 形式の user skill が存在する
- **WHEN** `<app userData>/.agents/skills` 配下に symlink 形式で Skill が配置されている
- **THEN** 一覧に当該 Skill が `source=user` として含まれる

### Requirement: Skills ライブラリ準拠の削除
アプリは user skill 削除時に `skills` ライブラリの管理境界を尊重し、bundled/system skill を削除対象として扱ってはならない（MUST NOT）。削除成功時は次回送信から反映されるようランタイム側状態を同期しなければならない（SHALL）。

#### Scenario: user skill の削除成功
- **WHEN** ユーザーが user skill を削除する
- **THEN** 対象 skill が管理ディレクトリから除去され、次回送信時のランタイムに反映される

#### Scenario: bundled skill の削除要求
- **WHEN** ユーザーが bundled/system skill の削除を要求する
- **THEN** 削除は拒否され、エラー理由が UI に返される

### Requirement: 一覧・削除の可観測エラー通知
一覧または削除処理が失敗した場合、アプリはユーザー操作が継続可能な形でエラーを通知しなければならない（SHALL）。

#### Scenario: 一覧取得失敗
- **WHEN** 一覧取得処理で I/O もしくは解決エラーが発生する
- **THEN** UI は空状態にフォールバックせず、失敗理由をステータス表示する

#### Scenario: 削除失敗
- **WHEN** 削除対象の判定または削除処理でエラーが発生する
- **THEN** UI は失敗理由を表示し、既存一覧表示は保持される
