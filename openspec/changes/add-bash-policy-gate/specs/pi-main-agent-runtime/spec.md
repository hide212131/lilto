## MODIFIED Requirements

### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で `pi-coding-agent` SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。さらに、Pi session 作成時に app 管理の extension を読み込み、tool 実行前フックを runtime に注入できなければならない（MUST）。

#### Scenario: Main で SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は `pi-coding-agent` SDK API を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要な CLI を起動する
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

#### Scenario: app 管理 extension が Pi runtime に組み込まれる
- **WHEN** Main が Pi session を作成する
- **THEN** システムは lilto が管理する extension を `ResourceLoader` 経由で読み込み、agent runtime が tool 実行前フックを利用できる状態にする

## ADDED Requirements

### Requirement: Main プロセスは Bash policy gate を runtime に適用できる
システムは、Pi の `bash` tool 呼び出し前に Bash policy gate extension を介在させ、判定結果に応じてブロック、確認、監査記録を実行できなければならない（MUST）。

#### Scenario: deny 判定の `bash` tool が Main で停止される
- **WHEN** agent runtime が deny 対象の `bash` command を生成する
- **THEN** Main は `bash` tool 実行前にその呼び出しを停止し、理由付きの block 結果を agent runtime へ返す

#### Scenario: confirm 判定の `bash` tool が UI 承認後のみ実行される
- **WHEN** agent runtime が confirm 対象の `bash` command を生成する
- **THEN** Main は利用者確認を経て、承認された場合のみ built-in `bash` 実行へ進める

#### Scenario: 非対話実行では fail-safe が適用される
- **WHEN** UI を持たない runtime で confirm 対象または設定エラー状態の `bash` command が発生する
- **THEN** Main は構成された fail-safe mode に従って block または confirm 相当の安全側判定を適用する
