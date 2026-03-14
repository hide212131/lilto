## 1. Dependency and runtime scaffolding

- [x] 1.1 `@openai/codex-sdk` を追加し、`Codex`, `startThread()`, `runStreamed()`, `resumeThread()` を前提 API として `package.json` と adapter 依存を更新する
- [x] 1.2 Pi 依存の session/model/auth 初期化コードを置き換えやすいよう、`src/main/agent-sdk.ts` に Codex adapter の骨格を追加し、必要な実装参照先として `CODEX_REPO_DIR` の SDK/CLI コードを確認する
- [x] 1.3 Pi 設定更新や Pi SDK 前提の補助コードのうち、Codex runtime では不要になる箇所を洗い出し、削除対象を明確化する

## 2. Auth and settings migration

- [x] 2.1 `src/main/auth-service.ts` を Codex 認証フロー対応へ置き換え、ブラウザ OAuth と API key の保存・復元・状態通知を lilto 管理に移す
- [x] 2.2 `src/shared/provider-settings.ts` と関連保存ロジックを更新し、Pi 複数 provider 前提の設定項目を整理しつつ、Codex の認証方式選択と API key 保存を持てるようにする
- [x] 2.3 `src/renderer/components/settings-modal.ts` の Providers & Models 画面を、Codex の認証方式選択、ブラウザ OAuth、API key、Proxy 設定を扱える UI に変更する
- [x] 2.4 認証状態に応じた送信可否表示と不足条件メッセージを、選択中の認証方式ベースで更新する

## 3. Agent runtime and tool integration

- [x] 3.1 `src/main/agent-sdk.ts` で Codex SDK の実行、ストリーミング、中断、標準化エラー変換を実装し、既存 `AgentRuntime` 契約を維持する
- [x] 3.2 `conversationId` と Codex session/thread handle の対応付けを実装し、retry と scheduler follow-up で再利用できるようにする
- [x] 3.3 `src/main/cron-tool.ts` を stdio MCP server から呼べる `cron` tool 実装として公開し、Codex runtime 側でその MCP server を接続して既存 scheduler daemon API と連携する
- [x] 3.4 Pi 設定追記や独自 skill 注入を削除し、Codex の自動 skill 検出が有効になるよう `workingDirectory` / `additionalDirectories` / 実行環境を整える

## 4. Verification and cleanup

- [x] 4.1 unit test を更新し、Codex のブラウザ OAuth、API key、応答ストリーム、tool 実行、scheduler follow-up、空応答防止を確認する
- [x] 4.2 GUI 変更として `/live-ui-manual-verification` を実施し、設定保存・認証・送信の基本導線を確認する
- [x] 4.3 `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` の生成を確認する
- [x] 4.4 不要になった Pi 依存 package / 型定義 / runtime 補助コードを削除し、OpenSpec artifacts と `tasks/lessons.md` を最終状態へ更新する
