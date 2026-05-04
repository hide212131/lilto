## 1. Runtime Update Detection

- [x] 1.1 Confirm folder/`SKILL.md` installs persist `sourceSkillPath`, `sourceSkillMtime`, and `installedVersion` in the user skill source record, and implement missing pieces if needed.
- [x] 1.2 Compare source version with `installedVersion` during update checks and return `updateAvailable=true` when they differ.
- [x] 1.3 Detect updates by source `SKILL.md` mtime when versions are the same or unavailable.
- [x] 1.4 Ensure removed or moved source paths do not fail the entire update-check operation.

## 2. Startup Auto Check

- [x] 2.1 Add renderer logic that automatically runs `skills:checkUpdates` after initialization.
- [x] 2.2 Store automatic check loading, success, and failure state in the Agent Skills UI state.
- [x] 2.3 Ensure automatic checks do not block app startup or normal UI operations.
- [x] 2.4 Ensure users can still manually rerun update checks after an automatic check.

## 3. Agent Skills UI

- [x] 3.1 Move the `アップデートを確認` button next to the installed-skills refresh button in the Agent Skills tab.
- [x] 3.2 Remove the dedicated update-check description section and integrate result display into installed-skills management.
- [x] 3.3 Confirm loading, no-update, update-available, and error states render correctly in the new location.

## 4. Tests

- [x] 4.1 Add a skill runtime unit test for folder-sourced skill version-difference detection.
- [x] 4.2 Add or keep skill runtime coverage for folder-sourced skill mtime-difference detection.
- [x] 4.3 Add a settings modal test for the update button placement and absence of explanatory copy.
- [x] 4.4 Add renderer/main contract coverage that startup update checks are invoked automatically.
- [x] 4.5 Run relevant unit tests.

## 5. GUI Verification

- [x] 5.1 Verify Agent Skills display and behavior with `/live-ui-manual-verification`.
- [x] 5.2 Run `npm.cmd run e2e:electron` and confirm success plus `test/artifacts/electron-e2e.png` generation.
