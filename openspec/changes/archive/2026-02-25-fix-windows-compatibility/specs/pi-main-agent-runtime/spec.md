## MODIFIED Requirements

### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で `pi-coding-agent` SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。

#### Scenario: Main で SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は `pi-coding-agent` SDK API を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要な CLI を起動する
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する