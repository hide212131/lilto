## ADDED Requirements

### Requirement: Electron常駐シェルの起動
システムは、アプリ起動時に Electron Main プロセスを初期化し、Renderer UI を利用可能な状態で起動しなければならない（MUST）。

#### Scenario: 初回起動でUIが利用可能になる
- **WHEN** ユーザーが Lilt-AI を起動する
- **THEN** Main プロセスが起動し、Renderer 画面が表示される

### Requirement: Main と Renderer の責務分離
システムは、ファイル I/O とエージェント実行責務を Main 側に配置し、Renderer 側は UI 表示と入力受付に限定しなければならない（MUST）。

#### Scenario: Renderer から危険操作を直接実行しない
- **WHEN** Renderer がユーザー入力を受け取る
- **THEN** Renderer は処理要求を IPC で Main に委譲し、直接のシステム操作を行わない

### Requirement: 常駐動作の継続
システムは、ウィンドウ表示状態が変化しても Main プロセスの常駐動作を維持できなければならない（MUST）。

#### Scenario: ウィンドウ再表示後も利用を継続できる
- **WHEN** ユーザーが一時的にウィンドウを閉じて再表示する
- **THEN** 新規プロセスを再生成せずに既存セッションで利用を継続できる
