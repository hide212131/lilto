## 1. 設定モデルと永続化の拡張

- [x] 1.1 `ProviderSettings`（Main/Renderer 共通型）に `networkProxy`（`httpProxy`/`httpsProxy`/`noProxy`）を追加する
- [x] 1.2 `src/main/provider-settings.ts` の正規化・保存バリデーションを更新し、既存設定ファイルを後方互換で読み込めることを確認する
- [x] 1.3 Proxy URL 入力不正時に `providers:saveSettings` がエラーを返すテストを追加する

## 2. Settings UI への Proxy 設定追加

- [x] 2.1 `Providers & Models` 画面に Proxy 設定セクション（HTTP/HTTPS/NO_PROXY）を追加する
- [x] 2.2 Proxy 入力値を既存保存フローに統合し、保存成功時に再読込で復元されることを確認する
- [x] 2.3 無効な Proxy URL 入力時のエラー表示と保存拒否を UI で確認できるようにする

## 3. Main 実行経路での Proxy 適用

- [x] 3.1 `src/main/agent-sdk.ts` で Proxy 設定を解決する処理を実装し、外部通信クライアントへ適用する
- [x] 3.2 `NO_PROXY` 対象ホストでは Proxy を適用しない分岐を実装する
- [x] 3.3 Proxy 接続失敗を既存の標準化エラー形式へ変換するテストを追加する

## 4. 擬似 Proxy 必須 E2E 検証

- [x] 4.1 `scripts/` に擬似外部 API + 擬似 Proxy を起動する E2E 補助コードを追加する（直接アクセス拒否・Proxy 経由のみ許可）
- [x] 4.2 Proxy 未設定時は失敗、Proxy 設定時は成功となる GUI E2E シナリオを追加する
- [x] 4.3 `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する
