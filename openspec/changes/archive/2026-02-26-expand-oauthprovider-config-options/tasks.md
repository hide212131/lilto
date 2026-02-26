## 1. 型と設定永続化の拡張

- [x] 1.1 `src/shared/provider-settings.ts` に OAuth provider の union 型（`anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity`）と `oauthProvider` 項目を追加する。
- [x] 1.2 `src/main/provider-settings.ts` の load/save/validation を更新し、`oauthProvider` の保存・復元と既存データ互換（未設定時 `anthropic`）を実装する。
- [x] 1.3 provider settings の unit test を追加・更新し、許可値検証と後方互換読み込みをカバーする。

## 2. OAuth 実行経路の provider 選択対応

- [x] 2.1 `src/main/auth-service.ts` の OAuth provider 解決を設定値注入方式に変更し、`getOAuthProvider(<selected>)` で開始できるようにする。
- [x] 2.2 未対応 provider の場合に provider 名付きで失敗理由を返すエラーハンドリングを追加する。
- [x] 2.3 auth 関連テストを更新し、provider 切替時の開始先分岐と失敗メッセージを検証する。

## 3. Settings UI と送信可否表示の更新

- [x] 3.1 `src/renderer/components/settings-modal.ts` に OAuth provider 選択 UI を追加し、保存 payload へ `oauthProvider` を含める。
- [x] 3.2 `src/renderer/app.ts` と関連表示ロジックを更新し、選択中 OAuth provider の認証状態に基づいて送信可否メッセージを切り替える。
- [x] 3.3 renderer 側テストを更新し、provider 選択の保存反映と未認証表示の切替を確認する。

## 4. 結合確認と回帰防止

- [x] 4.1 Main/Renderer の統合経路で `providers:getSettings` / `providers:saveSettings` / `auth:start` の入出力互換を確認するテストを追加する。
- [x] 4.2 GUI 変更として `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する。
- [x] 4.3 手動確認メモまたはテスト観点を更新し、5つの OAuth provider 候補が選択可能で保存復元されることを記録する。
