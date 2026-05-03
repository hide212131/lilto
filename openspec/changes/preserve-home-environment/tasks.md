## 1. 実装

- [x] 1.1 `setupSkillRuntime()` の `homeDir` 既定値を `appDataDir` から切り離し、userData を OS ホームとして返さないようにする
- [x] 1.2 `createCodexThreadFromSdk()` の environment 生成から `HOME` / `USERPROFILE` の userData 上書きを削除し、`CODEX_HOME` は維持する
- [x] 1.3 `ClaudeAuthService.startOAuth()` の spawn environment から `HOME` / `USERPROFILE` の userData 上書きを削除し、auth path と `CODEX_HOME` の明示指定を維持する
- [x] 1.4 `CodexAppServerClient.start()` の spawn environment から `HOME` / `USERPROFILE` の userData 上書きを削除し、`CODEX_HOME` の明示指定を維持する
- [x] 1.5 skills CLI の list/add/remove 実行 environment から `HOME` / `USERPROFILE` の userData 上書きを削除し、workspace/project root による `.agents/skills` 管理を維持する
- [x] 1.6 `index.ts` の各 service 初期化で、userData と OS ホームの意味が混ざらないよう `homeDir` / `codexHomeDir` / `workspaceDir` の受け渡しを整理する

## 2. テスト

- [x] 2.1 Agent SDK セッション生成テストを追加または更新し、`HOME` / `USERPROFILE` が userData に差し替えられず `CODEX_HOME` が渡ることを確認する
- [x] 2.2 Auth service の OAuth 起動テストを追加または更新し、spawn environment が OS ホームを保持し `CODEX_HOME` を渡すことを確認する
- [x] 2.3 Codex app-server client の起動テストを追加し、spawn environment が OS ホームを保持し `CODEX_HOME` を渡すことを確認する
- [x] 2.4 Skill runtime / skills CLI のテストを追加または更新し、user skills が workspace `.agents/skills` で管理され、CLI environment が userData HOME に依存しないことを確認する

## 3. 検証

- [x] 3.1 `npm.cmd test` または関連する Node テストを実行し、環境境界の回帰がないことを確認する
- [x] 3.2 `openspec.cmd status --change preserve-home-environment` を実行し、apply-ready であることを確認する
