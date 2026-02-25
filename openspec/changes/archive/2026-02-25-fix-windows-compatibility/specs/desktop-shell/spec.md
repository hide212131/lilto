## MODIFIED Requirements

### Requirement: Electron常駐シェルの起動
システムは、アプリ起動時に Electron Main プロセスを初期化し、Renderer UI を利用可能な状態で起動しなければならない（MUST）。さらに、Windows 環境では実行ポリシー差異に起因する起動失敗を回避できる実行経路（`.cmd` シム優先など）を採用しなければならない（MUST）。

#### Scenario: 初回起動でUIが利用可能になる
- **WHEN** ユーザーが Lilt-o を起動する
- **THEN** Main プロセスが起動し、Renderer 画面が表示される

#### Scenario: Windows で起動前提を満たして起動できる
- **WHEN** Windows 環境で PowerShell 実行ポリシーにより `.ps1` 実行が制限されている
- **THEN** システムは互換実行経路を選択し、起動に必要なコマンド実行を継続できる