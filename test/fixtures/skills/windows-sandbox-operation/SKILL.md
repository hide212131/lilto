---
name: windows-sandbox-operation
description: Exercise Windows sandbox operations with Temp workdir creation, Web fetch, and an allowed fixture executable.
---

Use this skill to verify Lilt-o Windows sandbox operation settings.

Use `config.sample.toml` in this directory as the baseline `CODEX_HOME/config.toml` for manual sandbox operation tests. Replace the Temp root and fixture exe directory placeholders with absolute paths on the test machine.

Run `node scripts/run-operation.js` from this skill directory to create the Temp workdir and fetch the Web page. Then run the executable pointed to by `LILTO_SANDBOX_FIXTURE_EXE` and write its result into the manifest workdir.

- Creates a random working directory under the system Temp directory.
- Fetches a small Web page and records the HTTP status plus a SHA-256 digest.
- Writes `manifest.json` and `web-result.json` into the Temp working directory.
- Expects the caller to run `LILTO_SANDBOX_FIXTURE_EXE` with a sandbox command and save `exe-result.json` beside the manifest.

Required environment variables:

- `LILTO_SANDBOX_FIXTURE_EXE`: absolute path to the allowed fixture executable.

Optional environment variables:

- `LILTO_SANDBOX_TEST_URL`: URL to fetch. Defaults to `https://example.com/`.
- `LILTO_SANDBOX_OUTSIDE_FILE`: when set, the script attempts a write to this path and records whether it was blocked.

Return the path from `manifestPath` and summarize whether `web.ok`, the separately recorded exe result, and `outsideWrite.blocked` are true.
