## MODIFIED Requirements

### Requirement: Windows sandbox セットアップ開始導線

システムは、Windows 上でユーザーが Codex Windows sandbox モードを `unelevated` または `elevated` に保存したとき、Codex app-server の `windowsSandbox/setupStart` を呼び出してセットアップを開始しなければならない（MUST）。セットアップ対象の `cwd` には Lilt-o の現在のワークスペースを渡さなければならない（MUST）。

#### Scenario: elevated モード保存時に setup が始まる

- **WHEN** Windows 上のユーザーが Settings で Windows sandbox モードを `elevated` に変更して保存する
- **THEN** システムは `windowsSandbox/setupStart` を `mode = elevated` で呼び出す

#### Scenario: unelevated モード保存時に setup が始まる

- **WHEN** Windows 上のユーザーが Settings で Windows sandbox モードを `unelevated` に変更して保存する
- **THEN** システムは `windowsSandbox/setupStart` を `mode = unelevated` で呼び出す

#### Scenario: Skill 運用テスト用 config.toml を生成できる

- **WHEN** Windows sandbox live test が sandbox 運用テスト Skill 用の一時 `CODEX_HOME` を準備する
- **THEN** システムは `sandbox_mode = "workspace-write"` と `[windows] sandbox` を含む `config.toml` を生成できる
- **AND** `sandbox_workspace_write.network_access` と `sandbox_workspace_write.writable_roots` により、Temp root と fixture exe directory を明示できる
