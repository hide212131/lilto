## ADDED Requirements

### Requirement: OS ホーム環境変数を保持する
システムは、Agent/Codex/Skill/Auth/App Server の子プロセス起動時に、`HOME` または `USERPROFILE` をアプリの `userData` ディレクトリへ上書きしてはならない（MUST NOT）。子プロセスは、親プロセスから継承した OS の通常ホーム環境を維持しなければならない（MUST）。

#### Scenario: Codex SDK セッションが OS ホームを保持する
- **WHEN** アプリが Agent runtime から Codex SDK セッションを開始する
- **THEN** Codex SDK に渡される environment の `HOME` と `USERPROFILE` は `app.getPath("userData")` に差し替えられない

#### Scenario: Codex OAuth 起動が OS ホームを保持する
- **WHEN** アプリが `codex login` を起動する
- **THEN** spawn environment の `HOME` と `USERPROFILE` は `app.getPath("userData")` に差し替えられない

#### Scenario: Codex app-server が OS ホームを保持する
- **WHEN** アプリが `codex app-server --listen stdio://` を起動する
- **THEN** spawn environment の `HOME` と `USERPROFILE` は `app.getPath("userData")` に差し替えられない

#### Scenario: Skills CLI が OS ホームを保持する
- **WHEN** アプリが skills CLI の list/add/remove 処理を実行する
- **THEN** CLI environment の `HOME` と `USERPROFILE` は `app.getPath("userData")` に差し替えられない

### Requirement: アプリ管理ディレクトリを明示的に渡す
システムは、アプリ固有の保存先を OS ホーム環境変数で表現してはならない（MUST NOT）。Codex state、workspace、user skills、auth state などのアプリ管理ディレクトリは、`CODEX_HOME`、`workspaceDir`、`projectRoot`、`userDataDir` などの明示的な値で渡さなければならない（MUST）。

#### Scenario: Codex state は CODEX_HOME で固定される
- **WHEN** アプリが Codex SDK、Codex OAuth、または Codex app-server を起動する
- **THEN** アプリ管理 Codex state の保存先は `CODEX_HOME` によって指定される

#### Scenario: User skills は workspace root で固定される
- **WHEN** アプリが user skill の一覧、追加、削除、実行対象検出を行う
- **THEN** user skills の保存先は `workspaceDir` または `projectRoot` 配下の `.agents/skills` として解決される

#### Scenario: userData はアプリデータの保存先として使われる
- **WHEN** アプリが provider settings、scheduler、auth-state、または bundled skills を保存する
- **THEN** 保存先は `userDataDir` または `CODEX_HOME` として明示され、`HOME` の差し替えに依存しない
