## ADDED Requirements

### Requirement: フォルダ由来 skill の更新検出
アプリは、フォルダまたは `SKILL.md` ファイルからインストールされた user skill について、インストール元 `SKILL.md` の version と更新時刻を利用して更新有無を検出しなければならない（MUST）。

#### Scenario: フォルダからインストールした skill の version 更新を検出する
- **WHEN** user skill がローカルフォルダからインストール済みで、インストール元 `SKILL.md` の version がインストール時点から変わっている
- **THEN** 更新確認結果はその skill を更新ありとして返す

#### Scenario: フォルダからインストールした skill の SKILL.md 更新時刻変更を検出する
- **WHEN** user skill がローカルフォルダからインストール済みで、インストール元 `SKILL.md` の更新時刻がインストール時点から変わっている
- **THEN** 更新確認結果はその skill を更新ありとして返す

#### Scenario: フォルダ由来 skill の source metadata を保存する
- **WHEN** ユーザーがローカルフォルダまたは `SKILL.md` ファイルから skill をインストールする
- **THEN** アプリはインストール元 `SKILL.md` の絶対パス、更新時刻、インストール時点の version を user skill の source record に保存する

#### Scenario: インストール元が存在しない場合も更新確認を継続する
- **WHEN** フォルダ由来 skill のインストール元 `SKILL.md` が削除または移動されている
- **THEN** アプリはその skill の更新検出を失敗として扱わず、他の skill の更新確認を継続する
