## ADDED Requirements

### Requirement: macOS・Windows 向けのクロスプラットフォームビルド
プロジェクトは macOS（主要ターゲット）と Windows（副次ターゲット）の両方でビルド・実行できなければならない（SHALL）。プラットフォーム固有の設定は分離して管理すること。

#### Scenario: macOS でのビルド成功
- **WHEN** macOS 環境で `cargo tauri build` を実行する
- **THEN** macOS 向けのアプリバンドル（`.app`）が生成される

#### Scenario: Windows でのビルド成功
- **WHEN** Windows 環境で `cargo tauri build` を実行する
- **THEN** Windows 向けのインストーラー（`.msi` または `.exe`）が生成される

### Requirement: 開発環境のセットアップ手順
新しい開発者がリポジトリをクローンしてからアプリを起動できるまでの手順が文書化されていなければならない（SHALL）。必要な依存関係（Rust、Node.js、Tauri CLI 等）のインストール方法を含むこと。

#### Scenario: 初回セットアップ後の開発サーバー起動
- **WHEN** セットアップ手順に従って依存関係をインストールし `cargo tauri dev` を実行する
- **THEN** ホットリロード付きの開発用アプリが起動する

### Requirement: 依存関係の明示的な管理
使用する依存関係（Rust クレート・npm パッケージ）はバージョンを固定して管理し、再現可能なビルドを保証しなければならない（SHALL）。

#### Scenario: クリーンビルドの再現性
- **WHEN** ロックファイル（`Cargo.lock`、`package-lock.json` 等）を使って別環境でビルドする
- **THEN** 同一のバイナリ（または機能的に同等なもの）が生成される
