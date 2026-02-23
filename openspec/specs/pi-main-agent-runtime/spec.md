# pi-main-agent-runtime Specification

## Purpose
TBD - created by archiving change add-pi-sdk-main-process-agent. Update Purpose after archive.
## Requirements
### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で `pi-coding-agent` SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。

#### Scenario: Main で SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は `pi-coding-agent` SDK API を直接呼び出して処理を開始する

### Requirement: 認証済み状態での問い合わせ応答
システムは、認証済み状態の問い合わせに対して、SDK 実行結果を構造化応答として Renderer に返却しなければならない（MUST）。

#### Scenario: 応答テキストが UI に返る
- **WHEN** 認証済みユーザーが質問を送信する
- **THEN** Main は SDK から得た応答を `promptResult` として Renderer に返す

### Requirement: 未認証時の実行拒否
システムは、Claude 認証が未完了の場合に問い合わせ実行を拒否し、認証が必要であることを示すエラーを返さなければならない（MUST）。

#### Scenario: 未認証の送信が拒否される
- **WHEN** 認証前のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、認証開始を促すエラーコードを返す

### Requirement: 実行失敗時の標準化エラー
システムは、SDK 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。

#### Scenario: SDK 失敗が UI で扱える形式になる
- **WHEN** `pi-coding-agent` SDK 呼び出しが例外を返す
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

