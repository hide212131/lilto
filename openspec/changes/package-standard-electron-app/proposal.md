## Why

現在の Lilt-o は開発用の `electron .` 起動を前提としており、利用者が一般的な Electron アプリのようにインストーラーや配布済みアプリから導入できる状態になっていない。ネイティブ補助バイナリや設定ファイルの同梱方法も配布前提で固まっていないため、配布可能なビルド経路を標準化しておく必要がある。

## What Changes

- Electron の配布ビルド設定を追加し、macOS と Windows で標準的にインストール可能な成果物を生成できるようにする。
- アプリ名、実行エントリ、アイコン、同梱リソース、出力ディレクトリを配布前提で整理し、開発起動と配布ビルドの責務を分離する。
- `scheduler-daemon` や `speech-transcriber` などのネイティブ補助バイナリが、配布後の `resources` 配下でも解決される前提を明文化する。
- 配布ビルドを検証する手順と release artifact の確認項目を追加し、`/opsx:apply` 時の完了条件を明確にする。

## Capabilities

### New Capabilities
- `installable-electron-distribution`: Lilt-o を標準的な Electron アプリとしてパッケージングし、インストール可能な配布成果物を生成・検証する。

### Modified Capabilities

なし。

## Impact

- 影響コード: [`/Users/hide/dev/lilto/package.json`](/Users/hide/dev/lilto/package.json), build/release 用 script, Electron packaging 設定ファイル, 必要に応じて [`/Users/hide/dev/lilto/src/main`](/Users/hide/dev/lilto/src/main) 配下の resource path 解決
- 影響成果物: `release/` 配下の配布物、アプリアイコンや metadata、配布手順ドキュメント
- 依存追加候補: `electron-builder` または同等の配布ツール、platform ごとの packaging metadata
