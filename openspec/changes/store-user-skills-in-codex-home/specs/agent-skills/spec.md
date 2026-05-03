## ADDED Requirements

### Requirement: User skills are stored under CODEX_HOME
システムは、アプリから追加・削除・一覧・更新確認する user skills を `CODEX_HOME/skills` 配下で管理しなければならない（MUST）。`HOME` / `USERPROFILE` を変更して user skill root を作ってはならない（MUST NOT）。

#### Scenario: User skill is added under CODEX_HOME
- **WHEN** ユーザーがアプリから Skill を追加する
- **THEN** 追加された Skill は `CODEX_HOME/skills/<skill-name>/SKILL.md` として保存される

#### Scenario: User skill list reads CODEX_HOME
- **WHEN** アプリが user skill 一覧を取得する
- **THEN** 一覧は `CODEX_HOME/skills` 配下の user skills を含む

#### Scenario: User skill removal deletes from CODEX_HOME
- **WHEN** ユーザーがアプリから user skill を削除する
- **THEN** 削除対象は `CODEX_HOME/skills/<skill-name>` 配下の skill である

#### Scenario: HOME remains unchanged
- **WHEN** アプリが skills CLI または skill 管理処理を実行する
- **THEN** `HOME` と `USERPROFILE` は user skill 保存先として上書きされない

### Requirement: Bundled skills remain protected under CODEX_HOME
システムは、bundled/system skills を `CODEX_HOME/skills/.system` 配下で管理しなければならない（MUST）。user skill の削除、更新、追加処理は `.system` 配下の skill を user skill として扱ってはならない（MUST NOT）。

#### Scenario: Bundled skill is listed separately
- **WHEN** アプリが skill 一覧を取得する
- **THEN** `CODEX_HOME/skills/.system` 配下の skill は bundled/system source として扱われる

#### Scenario: Bundled skill cannot be removed as user skill
- **WHEN** ユーザーが `.system` 配下の skill を user skill として削除しようとする
- **THEN** システムは削除を拒否する

### Requirement: Existing workspace skills are migrated non-destructively
システムは、旧保存先 `workspaceDir/.agents/skills` に存在する user skills を起動時に `CODEX_HOME/skills` へ非破壊的に移行しなければならない（MUST）。移行時に同名 skill が既に `CODEX_HOME/skills` に存在する場合、既存 target を上書きしてはならない（MUST NOT）。

#### Scenario: Legacy workspace skill is copied to CODEX_HOME
- **WHEN** `workspaceDir/.agents/skills/<skill-name>/SKILL.md` が存在し、`CODEX_HOME/skills/<skill-name>` が存在しない
- **THEN** システムはその skill を `CODEX_HOME/skills/<skill-name>` へコピーする

#### Scenario: Existing CODEX_HOME skill wins during migration
- **WHEN** 旧保存先と `CODEX_HOME/skills` の両方に同名 skill が存在する
- **THEN** システムは `CODEX_HOME/skills` 側を維持し、旧保存先で上書きしない
