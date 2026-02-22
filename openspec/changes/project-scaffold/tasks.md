## 1. 開発環境のセットアップ

- [ ] 1.1 Rust ツールチェーン（rustup）のインストール確認手順を README に記載する
- [ ] 1.2 Node.js と pnpm のインストール確認手順を README に記載する
- [ ] 1.3 Tauri CLI（`cargo install tauri-cli`）のインストール手順を README に記載する

## 2. Tauri プロジェクトの初期化

- [ ] 2.1 `pnpm create tauri-app` でプロジェクトを作成する（テンプレート: Vanilla TypeScript + Vite）
- [ ] 2.2 `tauri.conf.json` のアプリ名・バンドル ID・バージョンを Lilt-AI 用に設定する
- [ ] 2.3 `Cargo.lock` と `pnpm-lock.yaml` を `.gitignore` に追加せず、バージョン管理対象にする
- [ ] 2.4 `cargo tauri dev` で開発サーバーが起動することを確認する

## 3. システムトレイの実装

- [ ] 3.1 `Cargo.toml` に `tauri` の `tray-icon` フィーチャーを有効化する
- [ ] 3.2 トレイ用アイコン画像（PNG 32×32）をプレースホルダーとして `icons/` に配置する
- [ ] 3.3 `src-tauri/src/tray.rs` を作成し、トレイアイコンとコンテキストメニュー（「表示/非表示」「終了」）を実装する
- [ ] 3.4 `main.rs` から `tray.rs` を呼び出し、起動時にトレイアイコンが表示されることを確認する

## 4. ウィンドウ管理の実装

- [ ] 4.1 `src-tauri/src/window.rs` を作成し、ウィンドウの表示・非表示を切り替える関数を実装する
- [ ] 4.2 `CloseRequested` イベントをインターセプトし、ウィンドウを閉じる代わりに非表示（`hide()`）にする
- [ ] 4.3 ウィンドウの最小化時もトレイに格納されることを確認する（Dock/タスクバーに表示されない）
- [ ] 4.4 トレイメニューの「表示/非表示」から `window.rs` の関数を呼び出す

## 5. macOS 向けの設定

- [ ] 5.1 `tauri.conf.json` の `bundle.macOS` に `LSUIElement = true` を設定し、Dock にアイコンが出ないことを確認する
- [ ] 5.2 macOS 用アプリバンドル（`.app`）のビルドが成功することを確認する（`cargo tauri build`）

## 6. アプリのライフサイクル管理

- [ ] 6.1 `src-tauri/src/lifecycle.rs` を作成し、終了時のクリーンアップ処理を実装する
- [ ] 6.2 トレイメニューの「終了」からアプリが完全終了することを確認する
- [ ] 6.3 `main.rs` を整理し、`tray.rs` / `window.rs` / `lifecycle.rs` を適切にモジュールとして呼び出す

## 7. Windows 向けの確認

- [ ] 7.1 `tauri.conf.json` の `bundle.windows` 設定（インストーラー形式）を確認・設定する
- [ ] 7.2 Windows 環境（または CI）でビルドが成功することを確認する（`.msi` または `.exe` の生成）
