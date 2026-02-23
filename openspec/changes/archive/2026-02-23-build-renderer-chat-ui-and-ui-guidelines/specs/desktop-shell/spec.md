## MODIFIED Requirements

### Requirement: Main と Renderer の責務分離
システムは、ファイル I/O とエージェント実行責務を Main 側に配置し、Renderer 側は UI 表示と入力受付に限定しなければならない（MUST）。また、Renderer が `pi-agent-core` などファイル入出力を伴う依存へ直接アクセスしてはならず、必要な処理は Main 側へポーティングして IPC 経由で利用しなければならない（MUST）。

#### Scenario: Renderer から危険操作を直接実行しない
- **WHEN** Renderer がユーザー入力を受け取る
- **THEN** Renderer は処理要求を IPC で Main に委譲し、直接のシステム操作を行わない

#### Scenario: Renderer 非対応依存は Main 側へ移管される
- **WHEN** UI 機能の実装でファイル I/O や Node/Electron Main 専用 API が必要になる
- **THEN** 当該処理は Main 側へ実装され、Renderer は IPC インターフェースのみを利用する
