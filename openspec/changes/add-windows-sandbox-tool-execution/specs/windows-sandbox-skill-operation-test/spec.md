## ADDED Requirements

### Requirement: Sandbox Skill 運用テスト資産

Lilt-o は、Windows sandbox 配下で Agent Skill の Temp 作業、Web 取得、許可済み exe 実行をまとめて検証できるテスト資産を提供しなければならない（MUST）。

#### Scenario: Skill が Temp 配下にランダム作業フォルダを作成する

- **WHEN** Windows sandbox live test が sandbox 運用テスト Skill を実行する
- **THEN** Skill は `%TEMP%` 配下にランダム名の作業フォルダを作成する
- **AND** Skill は作業フォルダ内に実行 manifest を書き込む

#### Scenario: Skill が Web 情報を取得する

- **WHEN** sandbox 運用テスト Skill が Web 取得ステップを実行する
- **THEN** Skill は設定された URL から情報を取得する
- **AND** HTTP status と取得結果の短い digest を作業フォルダへ記録する

#### Scenario: Skill が fixture exe を実行する

- **WHEN** sandbox 運用テスト Skill が fixture exe 実行ステップを実行する
- **THEN** Skill は許可済み fixture ディレクトリ配下の exe を起動する
- **AND** exit code、stdout、stderr を作業フォルダへ記録する

#### Scenario: 許可外書き込みは拒否される

- **WHEN** sandbox 運用テストが許可済み writable root 外への書き込みを試す
- **THEN** 書き込みは失敗する
- **AND** テストは許可外ファイルが作成されていないことを確認する

### Requirement: Sandbox Skill 用 config.toml

Lilt-o は、sandbox 運用テスト Skill を実行する一時 `CODEX_HOME/config.toml` に必要最小限の Windows sandbox 設定を書き込まなければならない（MUST）。

#### Scenario: config.toml に workspace-write と Windows sandbox mode が含まれる

- **WHEN** sandbox 運用テストが一時 `CODEX_HOME` を準備する
- **THEN** `config.toml` は `sandbox_mode = "workspace-write"` を含む
- **AND** `[windows] sandbox` は `elevated` または `unelevated` のいずれかを含む
- **AND** `[windows] sandbox_private_desktop` を明示する

#### Scenario: config.toml に Temp と fixture exe の writable root が含まれる

- **WHEN** sandbox 運用テストが一時 `CODEX_HOME/config.toml` を生成する
- **THEN** `[sandbox_workspace_write] network_access = true` を含む
- **AND** `writable_roots` には `%TEMP%` の実パスを含む
- **AND** `writable_roots` には fixture exe ディレクトリの実パスを含む
