## Why

現状の設定画面は Claude OAuth 専用で、OpenAI Completion Compatible な任意エンドポイントを利用したい要件を満たせない。`pi-web-ui` と `example` で実証済みの Providers & Models 方式へ揃えることで、複数プロバイダー運用を同一 UX で扱えるようにする。

## What Changes

- 設定メニューの `Claude Auth` を `Providers & Models` に置き換え、Claude と Custom Provider を同一画面で管理可能にする。
- Claude 設定は既存 OAuth フローを維持しつつ、Providers & Models 内の1プロバイダーとして表示する。
- `Custom Provider` を追加し、少なくとも `OpenAI Completions Compatible` の `name/baseUrl/apiKey` を設定・保存できるようにする。
- `pi-web-ui` / `packages/web-ui/example` の設定タブ構成とフォーム責務を参照し、Desktop 側へポーティングする。
- チャット実行時は、設定済みプロバイダー情報（Claude または Custom Provider）に基づいて実行可否と接続先判定を行う。

## Capabilities

### New Capabilities
- `providers-models-settings`: Settings モーダルで複数プロバイダー（Claude / Custom Provider）を登録・編集・利用可能状態で管理する。

### Modified Capabilities
- `claude-oauth-chat-bootstrap`: Claude 認証導線を単独画面から Providers & Models 画面内の Claude セクションへ移設し、共存 UX に変更する。
- `pi-main-agent-runtime`: 送信時のプロバイダー解決を Claude 固定から設定ベースへ拡張し、Custom Provider（OpenAI Completions Compatible）を利用可能にする。

## Impact

- 影響コード: `src/renderer/index.html`, `src/renderer/renderer.ts`, `src/main/*`（IPC 契約・設定保存・実行分岐）。
- 参照/移植元: `/Users/hide/Github/pi-mono/packages/web-ui/src/dialogs/ProvidersModelsTab.ts`, `/Users/hide/Github/pi-mono/packages/web-ui/src/dialogs/CustomProviderDialog.ts`, `/Users/hide/Github/pi-mono/packages/web-ui/example/src/main.ts`。
- 追加考慮: 既存認証状態イベントとの後方互換、設定未完了時エラー文言、E2E セレクタ更新。
