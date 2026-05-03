## Context

現在の `setupSkillRuntime()` は `userSkillsDir` を `workspaceDir/.agents/skills` として解決し、アプリからの追加・削除・一覧・更新確認もその root を使っている。一方で bundled/system skills は `CODEX_HOME/skills/.system` に配置されている。

前回の `preserve-home-environment` では `HOME` / `USERPROFILE` を userData に差し替えない方針にしたため、workspace `.agents/skills` を `$HOME/.agents/skills` として Codex に見せる前提は使えない。Codex が安定して参照できる app-managed root として、user skills も `CODEX_HOME/skills` 配下へ移す。

## Goals / Non-Goals

**Goals:**
- アプリから追加する user skills を `CODEX_HOME/skills/<skill-name>` に保存する。
- bundled/system skills は `CODEX_HOME/skills/.system/<skill-name>` に維持し、user 操作から保護する。
- 一覧、削除、更新確認、実行対象 discovery が同じ `CODEX_HOME/skills` root を共有する。
- 旧 workspace `.agents/skills` にある既存 user skills は、初回 runtime setup 時に `CODEX_HOME/skills` へ非破壊コピーする。
- `HOME` / `USERPROFILE` は引き続き変更しない。

**Non-Goals:**
- Codex 本体や skills CLI の仕様変更はしない。
- system/bundled skills の配置先は変更しない。
- workspace `.agents/skills` を新規追加先として使い続けない。

## Decisions

1. User skill root は `CODEX_HOME/skills`

`resolveWorkspaceUserSkillsDir(workspaceDir)` を主経路から外し、`resolveCodexUserSkillsDir(codexHomeDir)` のような resolver を追加する。`appSkillsDir` は `CODEX_HOME/skills`、`bundledSkillsDir` は `CODEX_HOME/skills/.system`、`userSkillsDir` は `CODEX_HOME/skills` として扱う。

`.system` は user root の中に存在するため、metadata discovery、list、delete、update check では既存の bundled 除外ロジックを必ず通す。

2. skills CLI には `CODEX_HOME` を渡し、projectRoot 依存を減らす

アプリ管理の追加・削除で skills CLI を使う場合も、環境変数として `CODEX_HOME` を渡し、`HOME` は変更しない。CLI が `CODEX_HOME/skills` を扱えるならそれを使い、CLI が workspace 前提の挙動をする経路では直接コピー/削除ロジックへ寄せる。

3. 旧 workspace skills は非破壊コピーで移行する

`workspaceDir/.agents/skills` に存在する user skills は、起動時に `CODEX_HOME/skills` へコピーする。ただし既に同名 skill が `CODEX_HOME/skills` にある場合は上書きしない。移行後も旧ディレクトリは削除しない。

4. `userSkillsDir` は UI/IPC の単一 source of truth にする

`index.ts` で生成された `skillRuntime.userSkillsDir` を IPC に渡し、追加・削除・一覧・更新確認はその値だけを見る。`workspaceDir` は AGENTS.md や作業ディレクトリ用途に残すが、user skill storage root としては使わない。

## Risks / Trade-offs

- [Risk] `CODEX_HOME/skills` 直下に `.system` と user skills が共存するため、削除処理が system skill を巻き込む可能性 → `isPathWithin(bundledSkillsDir, skillDir)` の保護を維持し、テストで `.system` 配下削除拒否を確認する。
- [Risk] 旧 workspace skill と新 root skill が同名の場合に意図しない上書きが起きる → 移行は non-destructive copy とし、既存 target を優先する。
- [Risk] skills CLI が workspace `.agents/skills` 前提の場合、追加先が戻る → 追加後に `CODEX_HOME/skills` に存在することを検証し、必要なら直接コピー方式へ切り替える。
- [Risk] `%CODEX_HOME%` 未設定時の保存先が不明瞭になる → 既存 `resolveCodexHomeDir(appDataDir)` に従い、既定では `app.getPath("userData")/codex/skills` を使う。
