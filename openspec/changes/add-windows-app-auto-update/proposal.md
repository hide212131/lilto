## Why

更新のたびに配布ページからインストーラーを探す必要がある。Windows のインストール済みアプリから更新を見つけ、同意後にインストールと再起動まで進められるようにする。

## What Changes

- 起動完了後に非同期で更新を確認し、新版があれば更新を促す。
- アプリメニューとトレイメニューに「更新を確認…」を追加する。
- 同意後にダウンロードし、「再起動してインストール」で既存 NSIS を起動する。
- 更新用メタデータの生成・検証・GitHub Releases への公開を配布工程へ追加する。
- Windows x64 の NSIS インストール版を先行対象にする。

## Capabilities

### New Capabilities

- `app-auto-update`: 更新確認、同意、取得、終了・インストール・再起動、公開と検証の契約。

### Modified Capabilities

なし。既存のインストール可能な配布に、独立した更新機能を追加する。

## Impact

- Main の更新サービス、メニュー、起動・終了処理、runtime の終了インターフェース。
- Renderer の更新ダイアログと preload/shared IPC、未送信入力保護。
- `electron-updater` の本番依存、package/lock、builder 設定、release workflow、成果物検証。
- 単体・ライブ画面・最終 GUI E2E と、Windows の実インストール更新検証。

## Non-goals

macOS 自動更新、強制更新、定期ポーリング、beta チャンネル、自動ダウンロード、無操作インストール、更新サーバー新設。本依頼では設計資料までを作成し、アプリ実装・公開は行わない。
