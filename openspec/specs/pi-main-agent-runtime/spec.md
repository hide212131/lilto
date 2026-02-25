# pi-main-agent-runtime Specification

## Purpose
TBD - created by archiving change add-pi-sdk-main-process-agent. Update Purpose after archive.
## Requirements
### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で `pi-coding-agent` SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。

#### Scenario: Main で SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は `pi-coding-agent` SDK API を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要な CLI を起動する
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

### Requirement: 認証済み状態での問い合わせ応答
システムは、現在選択されている provider の準備完了状態で問い合わせを受理し、provider に応じた SDK 実行結果を構造化応答として Renderer に返却しなければならない（MUST）。

#### Scenario: Claude が選択され認証済みなら応答テキストが返る
- **WHEN** provider が Claude かつ OAuth 認証済みのユーザーが質問を送信する
- **THEN** Main は Claude 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Custom Provider が選択され設定済みなら応答テキストが返る
- **WHEN** provider が Custom Provider（OpenAI Completions Compatible）で必要設定が完了したユーザーが質問を送信する
- **THEN** Main は Custom Provider 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

### Requirement: 未認証時の実行拒否
システムは、現在選択されている provider の前提条件が未完了の場合に問い合わせ実行を拒否し、不足条件を示すエラーを返さなければならない（MUST）。

#### Scenario: Claude 未認証の送信が拒否される
- **WHEN** provider が Claude で OAuth 未完了のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、Claude 認証が必要であることを示すエラーコードを返す

#### Scenario: Custom Provider 未設定の送信が拒否される
- **WHEN** provider が Custom Provider で `baseUrl` など必須設定が不足した状態で質問を送信する
- **THEN** Main は問い合わせを実行せず、不足設定を示すエラーコードを返す

### Requirement: 実行失敗時の標準化エラー
システムは、SDK 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。

#### Scenario: SDK 失敗が UI で扱える形式になる
- **WHEN** `pi-coding-agent` SDK 呼び出しが例外を返す
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

### Requirement: ループイベントの Renderer 中継
システムは、Main プロセスで実行されるエージェントループの進行イベントを Renderer に逐次通知しなければならない（MUST）。通知には少なくともイベント種別とイベントに紐づく識別子（例: `toolCallId`）を含めなければならない（MUST）。

#### Scenario: ツール実行開始イベントが通知される
- **WHEN** Main のエージェント実行で `tool_execution_start` が発生する
- **THEN** Renderer へ同イベントが中継される

#### Scenario: ツール実行終了イベントが通知される
- **WHEN** Main のエージェント実行で `tool_execution_end` が発生する
- **THEN** Renderer へ同イベントが中継される

### Requirement: 実行終了時のイベントストリーム終端
システムは、エージェント実行が完了・失敗・中断のいずれで終了した場合でも、Renderer が進行中表示を確実に終了できる終端イベントまたは等価な終了通知を送出しなければならない（MUST）。

#### Scenario: 正常完了で終端通知が届く
- **WHEN** エージェント実行が正常完了する
- **THEN** Renderer は終端通知を受信できる

#### Scenario: 失敗時も終端通知が届く
- **WHEN** エージェント実行が失敗する
- **THEN** Renderer は終端通知を受信できる

