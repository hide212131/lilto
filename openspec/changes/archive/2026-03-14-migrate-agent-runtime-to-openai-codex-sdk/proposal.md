## Why

現在の lilto は Main プロセスのコーディングエージェント実行を `@mariozechner/pi-coding-agent` と `@mariozechner/pi-ai` に強く依存しており、session 生成、OAuth、model 解決、custom tool 接続が Pi 固有 API に縛られています。コーディングエージェントの実装基盤を OpenAI Codex TypeScript SDK へ統一することで、将来の保守対象を絞り、Codex 向けの認証・実行・ツール連携を lilto 側で直接制御できる状態にする必要があります。

## What Changes

- Electron Main のエージェント実行基盤を `pi-coding-agent` から OpenAI Codex TypeScript SDK へ置き換え、session 作成、ストリーミング受信、中断、エラー正規化を Codex SDK ベースへ再定義する。
- **BREAKING** OAuth provider 前提を Pi の複数 provider 抽象から外し、Codex SDK が扱えるブラウザ OAuth と API key の認証方式に設定 UI と runtime を合わせる。
- **BREAKING** Pi 固有の model registry / auth storage / custom tool 登録を廃止し、Codex SDK の thread API と MCP 連携前提に合わせて `cron` tool・skill 注入・会話継続の責務を再設計する。
- Providers & Models 画面、認証開始導線、送信可否表示を新しい runtime 制約に合わせて整理し、ユーザーが現在利用可能な実行経路だけを選べるようにする。
- 既存テストと E2E を更新し、Codex SDK 実行で空応答にならないこと、loop event が UI に継続して反映されること、scheduler follow-up が同一会話で動作することを検証できるようにする。

## Capabilities

### New Capabilities

なし

### Modified Capabilities

- `pi-main-agent-runtime`: Main プロセスのエージェント実行要件を Pi SDK 前提から OpenAI Codex TypeScript SDK 前提へ変更し、session 継続、ストリーミング、失敗時の標準化、scheduler 連携方式を更新する
- `providers-models-settings`: Providers & Models 画面の provider 選択肢、OAuth/API key の保存対象、準備状態表示を Codex SDK ベースの実行制約へ変更する
- `claude-oauth-chat-bootstrap`: Pi `ai` パッケージ経由の OAuth 開始要件を廃止し、Codex SDK に対応した認証開始と認証状態反映へ変更する
- `cron-scheduler-tool`: Pi Custom Tool 前提の `cron` 提供要件を、Codex runtime が接続する MCP server の tool・引数・結果形式へ変更する

## Impact

- 影響コード: `src/main/agent-sdk.ts`, `src/main/auth-service.ts`, `src/main/cron-tool.ts`, `src/main/skill-runtime.ts`, `src/main/ipc.ts`, `src/shared/provider-settings.ts`, `src/renderer/components/settings-modal.ts`, テスト一式
- 依存変更: `@mariozechner/pi-coding-agent` / `@mariozechner/pi-ai` の削減または撤去、`@openai/codex-sdk` の追加、必要であれば OpenAI 認証補助ライブラリの追加
- 実装参照: `.env` の `CODEX_REPO_DIR` が指す Codex 本体実装を参照し、SDK/CLI の skill 検出と thread API の実挙動に合わせて adapter を組む
- 互換性影響: 既存の Pi provider 名、Pi 固有 OAuth 資格情報、Pi 設定ファイル更新、Pi custom tool 連携に依存する挙動はそのままでは維持できない可能性が高い
- 検証影響: unit test の event mock と GUI/E2E の認証・送信シナリオを Codex SDK ベースに差し替える必要がある
