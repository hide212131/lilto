# Skills / Workspace Policy

- Skill bundle directory: `<app data>/skills`
- Bundled skill: `agent-browser` (`SKILL.md` + references/templates)
- Pi settings update targets:
  - `~/.pi/settings.json` (legacy compatibility)
  - `~/.pi/agent/settings.json` (current Pi SDK path)
- Workspace root: `~/.pi/workspaces`
- Project workspace: `~/.pi/workspaces/<project>`

## Cleanup Policy

- Cleanup runs on app startup.
- Default TTL: 168 hours (7 days).
- Workspaces older than TTL are removed recursively.
- Current project workspace is never removed.
- TTL override: `LILTO_PI_WORKSPACE_TTL_HOURS` environment variable.
