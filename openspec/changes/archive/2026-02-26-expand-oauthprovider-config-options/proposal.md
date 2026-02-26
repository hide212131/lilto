## Why

現在の OAuth 認証フローは `anthropic` 固定の前提が強く、設定画面から OAuth Provider を明示的に選択できないため、利用する AI サービスを切り替えたい要件に対応しづらい。`OAuthProvider` の許可値を拡張し、UI と保存設定の両方で選択可能にすることで、今後の provider 追加にも追従しやすくする。

## What Changes

- Settings の `Providers & Models` 画面で、OAuth Provider の選択肢を `anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity` として提示できるようにする。
- 選択した OAuth Provider を設定として保存し、再起動後も同じ選択状態を復元する。
- OAuth 開始処理が設定された provider を使用して実行されるようにし、失敗時は provider 不一致や未対応を識別できるエラーメッセージを返す。
- 既存の Custom Provider 設定導線との共存を維持し、送信可否の判定を「選択中 provider の認証・設定状態」に基づいて表示する。

## Capabilities

### New Capabilities
- なし

### Modified Capabilities
- `providers-models-settings`: OAuth Provider 選択 UI、保存/復元、選択中 provider に応じたステータス表示を要件化する。
- `claude-oauth-chat-bootstrap`: OAuth 開始・状態反映・再試行の要件を、固定 provider 前提から「選択中 OAuth provider」前提へ拡張する。

## Impact

- Affected specs: `openspec/specs/providers-models-settings/spec.md`, `openspec/specs/claude-oauth-chat-bootstrap/spec.md`
- Affected code (想定): `src/shared/provider-settings.ts`, `src/main/provider-settings.ts`, `src/main/auth-service.ts`, `src/renderer/components/settings-modal.ts`, `src/renderer/app.ts`
- API/IPC 影響: `providers:getSettings`, `providers:saveSettings`, `auth:start` の入出力に OAuth provider 設定項目が追加される可能性がある。
- テスト影響: provider 選択保存・復元、provider 別 OAuth 開始、送信可否表示のテスト追加/更新が必要。
