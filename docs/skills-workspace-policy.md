# Skills / Workspace Policy

- Skill directories:
  - Bundled skills (app managed): `<app data>/skills/bundled`
  - User-created skills (persistent): `~/.pi/skills`
- Bundled skills:
  - `agent-browser` (`SKILL.md` + references/templates)
  - `skill-creator` (`SKILL.md` + references/templates, build 時に GitHub から最新取得)
- Source control policy:
  - `skills/bundled/*` は Git 管理しない
  - `npm run build` 前に `scripts/sync-skill-creator.js` が最新 `skill-creator` を `skills/bundled/skill-creator` に同期する
- Discovery target: 両ディレクトリを探索対象に含める（同名衝突時は user-created を優先）
- Pi settings update targets:
  - `~/.pi/settings.json` (legacy compatibility)
  - `~/.pi/agent/settings.json` (current Pi SDK path)
  - `skills` には `~/.pi/skills` と `<app data>/skills/bundled` を登録する
- Workspace root: `~/.pi/workspaces`
- Project workspace: `~/.pi/workspaces/<project>`

## Cleanup Policy

- Cleanup runs on app startup.
- Default TTL: 168 hours (7 days).
- Workspaces older than TTL are removed recursively.
- Current project workspace is never removed.
- TTL override: `LILTO_PI_WORKSPACE_TTL_HOURS` environment variable.
