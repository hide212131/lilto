# pi-main-agent-runtime Specification

## Purpose
TBD - created by archiving change add-pi-sdk-main-process-agent. Update Purpose after archive.
## Requirements
### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で OpenAI Codex TypeScript SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。

#### Scenario: Main で Codex SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は OpenAI Codex TypeScript SDK を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要なローカルコマンド実行を行う
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

### Requirement: 認証済み状態での問い合わせ応答
システムは、選択中の Codex 認証方式で実行に必要な認証が完了した状態で問い合わせを受理し、Codex SDK の実行結果を構造化応答として Renderer に返却しなければならない（MUST）。また、外部通信が必要な Codex 実行では Proxy 設定を考慮した経路で処理しなければならない（MUST）。

#### Scenario: Codex 認証済みなら応答テキストが返る
- **WHEN** Codex 認証済みのユーザーが質問を送信する
- **THEN** Main は Codex 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: API key 設定済みなら応答テキストが返る
- **WHEN** 認証方式が API key で、有効な Codex API key が保存されたユーザーが質問を送信する
- **THEN** Main は保存済み API key を使って Codex 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Proxy 必須環境でも設定済みなら応答テキストが返る
- **WHEN** 実行環境が Proxy 経由でのみ外部接続可能で、必要な Proxy 設定が保存されている
- **THEN** Main は問い合わせを成功させ、応答を `promptResult` として Renderer に返す

### Requirement: 未認証時の実行拒否
システムは、選択中の認証方式に応じて Codex 実行に必要な認証または必須設定が未完了の場合に問い合わせ実行を拒否し、不足条件を示すエラーを返さなければならない（MUST）。

#### Scenario: Codex 未認証の送信が拒否される
- **WHEN** Codex 認証が未完了のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、Codex 認証が必要であることを示すエラーコードを返す

#### Scenario: API key 未設定の送信が拒否される
- **WHEN** 認証方式が API key で、Codex API key が未設定のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、API key 設定が必要であることを示すエラーコードを返す

### Requirement: 実行失敗時の標準化エラー
システムは、Codex SDK 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。Proxy 経路の接続失敗も同じ標準化エラー形式で返さなければならない（MUST）。

#### Scenario: SDK 失敗が UI で扱える形式になる
- **WHEN** OpenAI Codex TypeScript SDK 呼び出しが例外を返す
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Proxy 接続失敗が標準化エラーになる
- **WHEN** Proxy 接続に失敗して外部通信が確立できない
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

### Requirement: 外部通信への Proxy 設定適用
システムは、外部ネットワークへ接続するエージェント実行時に、保存済み `networkProxy.useProxy` 設定を解決して通信経路へ適用しなければならない（MUST）。

#### Scenario: Proxy 設定ありで外部通信が Proxy 経由になる
- **WHEN** `networkProxy.useProxy = true` で問い合わせを実行する
- **THEN** Main は実行環境の `HTTP_PROXY` / `HTTPS_PROXY` 設定を利用した通信経路で外部通信を実行する

#### Scenario: Proxy 設定オフで直接経路を選択する
- **WHEN** `networkProxy.useProxy = false` で問い合わせを実行する
- **THEN** Main は Proxy 強制を行わず、直接経路で外部通信を実行する

### Requirement: Main プロセスは scheduler daemon を起動監視できる
システムは、Electron Main プロセス起動時に scheduler daemon を初期化し、コマンド送信とイベント受信が可能な状態を維持しなければならない（MUST）。daemon が異常終了した場合、Main は障害を観測し、エージェント実行と通知機能が扱えるエラーとして表面化しなければならない（MUST）。

#### Scenario: アプリ起動時に scheduler daemon が利用可能になる
- **WHEN** lilto の Main プロセスが起動する
- **THEN** システムは scheduler daemon を起動し、ready 状態を確認してから scheduler API を受け付ける

#### Scenario: daemon 異常終了を検知する
- **WHEN** scheduler daemon が実行中に異常終了する
- **THEN** システムはその失敗をログとエラー応答で観測可能にする

### Requirement: Main プロセスは cron custom tool を agent runtime に公開する
システムは、Codex SDK のエージェント実行中に `cron` tool を利用可能にするため、Main から接続可能な stdio MCP server を公開しなければならない（MUST）。tool 実行結果は通常のツール実行イベントと同様に Renderer へ中継されなければならない（MUST）。

#### Scenario: AI が高水準 operation で timer を登録する
- **WHEN** エージェント実行中に AI が MCP 経由の `cron` tool の `set_timer` を呼び出す
- **THEN** Main はその入力を scheduler daemon 用の one-shot schedule に正規化し、結果を MCP tool 実行結果として AI に返す

#### Scenario: AI が低水準 operation で複雑な schedule を登録する
- **WHEN** エージェント実行中に AI が MCP 経由の `cron` tool の `create` または `update` を呼び出す
- **THEN** Main は与えられた `runAt` または `cronExpr` をそのまま scheduler daemon へ転送し、結果を MCP tool 実行結果として AI に返す

#### Scenario: cron MCP tool の失敗が標準化される
- **WHEN** `cron` MCP tool の入力不正または scheduler daemon エラーが発生する
- **THEN** Main はエラーコードと説明を含む失敗結果を返し、Renderer にも失敗イベントを中継する

### Requirement: scheduler 発火イベントを対象セッションへ配送できる
システムは、scheduler daemon から発火イベントを受信したとき、payload に含まれる `sessionId` を解決して対象チャットへ通知を追加しなければならない（MUST）。また、アプリが非フォーカス時は OS 通知と未読バッジも更新しなければならない（MUST）。

#### Scenario: 発火イベントが対象チャットへ反映される
- **WHEN** Main が scheduler daemon から有効な `sessionId` を持つ発火イベントを受信する
- **THEN** システムは対象 session のチャットへ通知メッセージを追加する

#### Scenario: 非フォーカス時にデスクトップ通知も出る
- **WHEN** scheduler 発火時にアプリウィンドウが非フォーカス状態である
- **THEN** システムはチャット反映に加えてデスクトップ通知と未読バッジ更新を行う

### Requirement: Main プロセスは scheduler follow-up 情報を Renderer へ渡せる
システムは、scheduler 発火イベントに follow-up 指示が含まれる場合、その情報を Renderer が同一会話で follow-up 実行に使える形で中継しなければならない（MUST）。

#### Scenario: follow-up 指示があれば Renderer へ同梱して中継する
- **WHEN** Main が `followUpInstruction` を含む scheduler 発火イベントを受信する
- **THEN** システムは対象 session へ送る scheduler 通知イベントに `followUpInstruction` を含めて Renderer へ中継する

#### Scenario: Renderer 起点 follow-up の loop event が通常応答と同様に中継される
- **WHEN** Renderer が scheduler follow-up として `submitPrompt` を呼び出し AI が tool を実行する
- **THEN** Main はその loop event と最終応答を通常のエージェント実行と同じ経路で Renderer へ中継する
