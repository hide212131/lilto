# desktop-shell Specification

## Purpose
TBD - created by archiving change initial-agent-scaffold. Update Purpose after archive.
## Requirements
### Requirement: Electron常駐シェルの起動
システムは、アプリ起動時に Electron Main プロセスを初期化し、Renderer UI を利用可能な状態で起動しなければならない（MUST）。さらに、Windows 環境では実行ポリシー差異に起因する起動失敗を回避できる実行経路（`.cmd` シム優先など）を採用しなければならない（MUST）。

#### Scenario: 初回起動でUIが利用可能になる
- **WHEN** ユーザーが Lilt-o を起動する
- **THEN** Main プロセスが起動し、Renderer 画面が表示される

#### Scenario: Windows で起動前提を満たして起動できる
- **WHEN** Windows 環境で PowerShell 実行ポリシーにより `.ps1` 実行が制限されている
- **THEN** システムは互換実行経路を選択し、起動に必要なコマンド実行を継続できる

### Requirement: Main と Renderer の責務分離
システムは、ファイル I/O とエージェント実行責務を Main 側に配置し、Renderer 側は UI 表示と入力受付に限定しなければならない（MUST）。また、Renderer が `pi-agent-core` などファイル入出力を伴う依存へ直接アクセスしてはならず、必要な処理は Main 側へポーティングして IPC 経由で利用しなければならない（MUST）。

#### Scenario: Renderer から危険操作を直接実行しない
- **WHEN** Renderer がユーザー入力を受け取る
- **THEN** Renderer は処理要求を IPC で Main に委譲し、直接のシステム操作を行わない

#### Scenario: Renderer 非対応依存は Main 側へ移管される
- **WHEN** UI 機能の実装でファイル I/O や Node/Electron Main 専用 API が必要になる
- **THEN** 当該処理は Main 側へ実装され、Renderer は IPC インターフェースのみを利用する

### Requirement: 常駐動作の継続
システムは、ウィンドウ表示状態が変化しても Main プロセスの常駐動作を維持できなければならない（MUST）。

#### Scenario: ウィンドウ再表示後も利用を継続できる
- **WHEN** ユーザーが一時的にウィンドウを閉じて再表示する
- **THEN** 新規プロセスを再生成せずに既存セッションで利用を継続できる

