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