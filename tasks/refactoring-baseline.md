# Refactoring Baseline

作成日: 2026-06-10
対象スコープ: `src/`, `test/`, `scripts/`, `native/`

## Snapshot

- 対象ファイル数: 167
- 対象総行数: 60,887
- `test:unit` 実測時間: 約 2.4 秒（ローカル macOS 実行、`npm run test:unit`）

## Commands

```bash
npm_config_yes=true npx knip --reporter compact || true
npm_config_yes=true npx depcheck --json || true
rg --files src test scripts native | wc -l
rg --files src test scripts native | xargs wc -l | tail -n 1
```

## knip

### Unused files

- `scripts/e2e-cdp-command.js`
- `scripts/render-build-icon-electron.js`
- `scripts/render-runtime-icons-electron.js`
- `src/main/cron-mcp-server.ts`
- `src/preload.ts`
- `src/renderer/components/loop-status.ts`

### Unused dependencies

- `@openai/codex-sdk`
- `skills`

### Unused devDependencies

- `agent-browser`

### Unlisted dependencies / binaries

- `playwright-core` used by `scripts/electron-playwright.js`
- `powershell` reported as unlisted binary from `package.json`

### Unused exports

- `src/main/agent-sdk.ts`: `standardizeError`, `PiAgentBridge`
- `src/main/command-compat.ts`: `isWindowsPlatform`
- `src/main/skill-runtime.ts`: `shouldPrioritizeAgentBrowser`, `shouldPrioritizeSkillCreator`
- `src/shared/provider-settings.ts`: `DEFAULT_NETWORK_PROXY_SETTINGS`

### Unused exported types

- `src/main/ipc-contract.ts`: `PromptPayload`, `PromptValidationError`, `PromptValidationOk`
- `src/main/model-catalog.ts`: `ListedModel`
- `src/main/plugin-service.ts`: `PluginCatalogInfo`, `PluginInfo`, `PluginAppInfo`, `PluginListState`
- `src/main/provider-settings.ts`: `ActiveProvider`, `ChatSettings`, `CustomProviderSettings`, `HeartbeatSettings`, `NetworkProxySettings`, `OAuthProviderId`, `WindowsSandboxMode`, `WindowsSandboxSettings`
- `src/main/skill-runtime.ts`: `SkillSource`
- `src/main/windows-sandbox-setup.ts`: `WindowsSandboxSetupErrorCode`
- `src/renderer/types.ts`: `SkillSource`, `PluginCatalogSourceKind`, `PluginReadInfo`, `PluginMarketplaceLoadError`, `PluginListState`, `AuthPhase`, `ListedModel`
- `src/shared/agent-loop.ts`: `AgentRunEndStatus`, `LoopVisualStatus`, `ActiveTool`
- `src/shared/audio-transcription.ts`: `AudioTranscriptionErrorCode`
- `src/shared/scheduler.ts`: `ScheduleKind`, `SchedulerNotificationPayload`

## depcheck

### Unused dependencies

- `@openai/codex-sdk`
- `skills`

### Unused devDependencies

- `agent-browser`

### Missing dependencies

- `playwright-core` required by `scripts/electron-playwright.js`

## Notes

- `knip` / `depcheck` の結果には Electron の entrypoint や dynamic import、packaging 用 script が未使用扱いされる false positive が含まれる可能性がある。
- フェーズ 1 で削除判断を行うときは、この一覧を出発点にして `grep` と実行検証で確定する。

## Phase 1 Review

### Removed or narrowed in phase 1

- `src/main/user-data-path.ts` を `src/main/app-paths.ts` へ統合し、path 決定点を一本化した
- `src/renderer/components/loop-status.ts` を削除した
- `scripts/e2e-cdp-command.js` を削除した
- `scripts/render-runtime-icons-electron.js` を削除した
- `src/main/agent-sdk.ts` の `standardizeError` / `PiAgentBridge` は export を外し、内部実装へ限定した
- `src/main/command-compat.ts` の `isWindowsPlatform` は export を外し、内部実装へ限定した
- `src/main/skill-runtime.ts` の `shouldPrioritizeAgentBrowser` / `shouldPrioritizeSkillCreator` は export を外し、内部実装へ限定した
- `src/shared/provider-settings.ts` の `DEFAULT_NETWORK_PROXY_SETTINGS` は export を外し、内部実装へ限定した
- `package.json` から `@openai/codex-sdk`、`skills`、`agent-browser` を削除し、`playwright-core` を直接使う dependency として明示した
- `.claude/skills/` を正本とし、`scripts/sync-skills.js` により `.codex/skills/` と `.github/skills/` を生成物として同期する構成へ変更した

### Retained as verified false positives or runtime-needed files

- `scripts/render-build-icon-electron.js`: `scripts/prepare-build-assets.js` から参照される build asset 生成スクリプトのため保持
- `src/main/cron-mcp-server.ts`: `dist/main/cron-mcp-server.js` が `asarUnpack` と `resolveCronMcpServerPath`、live/contract test から参照されるため保持
- `src/preload.ts`: Electron preload の build entrypoint であり、IPC contract test 群も source を直接検証するため保持

### Validation

- `npm run test:unit`: pass
- `npm test`: pass
- `npm run dist:mac`: pass