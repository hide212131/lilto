## 1. Storage Root

- [x] 1.1 Add a resolver for the user skill root under `CODEX_HOME/skills` and stop using workspace `.agents/skills` as the primary user skill directory
- [x] 1.2 Keep bundled/system skills under `CODEX_HOME/skills/.system` and ensure user discovery/listing excludes `.system` from user results
- [x] 1.3 Update `setupSkillRuntime()` to return `userSkillsDir = CODEX_HOME/skills` and discover user + bundled skills from the new root

## 2. Migration

- [x] 2.1 Add non-destructive migration from legacy `workspaceDir/.agents/skills` into `CODEX_HOME/skills`
- [x] 2.2 Ensure migration does not overwrite an existing skill already present in `CODEX_HOME/skills`

## 3. Operations

- [x] 3.1 Update skill add/list/remove/update paths to use `CODEX_HOME/skills` as the user skill root
- [x] 3.2 Ensure user skill removal rejects `.system` bundled/system skills
- [x] 3.3 Keep `HOME` / `USERPROFILE` untouched during skill operations while passing `CODEX_HOME`

## 4. Tests

- [x] 4.1 Update setup runtime tests to assert user skills live under `CODEX_HOME/skills`
- [x] 4.2 Add migration tests for legacy workspace `.agents/skills`
- [x] 4.3 Update install/remove/list/update tests for the new user skill root and `.system` protection

## 5. Verification

- [x] 5.1 Run focused skill runtime tests
- [x] 5.2 Run `npm.cmd test`
- [x] 5.3 Run `openspec.cmd instructions apply --change store-user-skills-in-codex-home --json` and confirm all tasks are complete
