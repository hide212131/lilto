## MODIFIED Requirements

### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で OpenAI Codex TypeScript SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、Codex thread 起動時に `workspace-write` を選択し、Codex config override として `windows.sandbox` を渡して Windows sandbox backend が選択可能な起動条件を満たさなければならない（MUST）。

#### Scenario: Main で Codex SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は OpenAI Codex TypeScript SDK を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要なローカルコマンド実行を行う
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

#### Scenario: Windows sandbox 有効時は workspace-write で起動する
- **WHEN** Windows 上で保存済み Windows sandbox モードが `unelevated` または `elevated` である
- **THEN** Main は Codex thread を `workspace-write` で開始し、`windows.sandbox` 設定を Codex へ渡す

### Requirement: 認証済み状態での問い合わせ応答
システムは、選択中の Codex 認証方式で実行に必要な認証が完了した状態で問い合わせを受理し、Codex SDK の実行結果を構造化応答として Renderer に返却しなければならない（MUST）。また、外部通信が必要な Codex 実行では Proxy 設定を考慮した経路で処理しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、セットアップ完了済みの sandbox 実行経路を通しても同じ応答契約を維持しなければならない（MUST）。

#### Scenario: Codex 認証済みなら応答テキストが返る
- **WHEN** Codex 認証済みのユーザーが質問を送信する
- **THEN** Main は Codex 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: API key 設定済みなら応答テキストが返る
- **WHEN** 認証方式が API key で、有効な Codex API key が保存されたユーザーが質問を送信する
- **THEN** Main は保存済み API key を使って Codex 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Proxy 必須環境でも設定済みなら応答テキストが返る
- **WHEN** 実行環境が Proxy 経由でのみ外部接続可能で、必要な Proxy 設定が保存されている
- **THEN** Main は問い合わせを成功させ、応答を `promptResult` として Renderer に返す

#### Scenario: Windows sandbox 経由でも応答契約を維持する
- **WHEN** Windows sandbox モードが有効で setup 完了済みの状態でユーザーが質問を送信する
- **THEN** Main は sandboxed thread 経由で処理し、通常実行と同じ `promptResult` 契約で応答を返す

### Requirement: 未認証時の実行拒否
システムは、選択中の認証方式に応じて Codex 実行に必要な認証または必須設定が未完了の場合に問い合わせ実行を拒否し、不足条件を示すエラーを返さなければならない（MUST）。Windows sandbox モードが有効でも setup 未完了または未対応モードである場合、Main は問い合わせを開始してはならず（MUST NOT）、不足条件を示す標準化エラーを返さなければならない（MUST）。

#### Scenario: Codex 未認証の送信が拒否される
- **WHEN** Codex 認証が未完了のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、Codex 認証が必要であることを示すエラーコードを返す

#### Scenario: API key 未設定の送信が拒否される
- **WHEN** 認証方式が API key で、Codex API key が未設定のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、API key 設定が必要であることを示すエラーコードを返す

#### Scenario: Windows sandbox setup 未完了の送信が拒否される
- **WHEN** Windows sandbox モードが有効だが setup が完了していない状態で質問を送信する
- **THEN** Main は問い合わせを実行せず、Windows sandbox のセットアップが必要であることを示すエラーコードを返す

### Requirement: 実行失敗時の標準化エラー
システムは、Codex SDK 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。Proxy 経路の接続失敗も同じ標準化エラー形式で返さなければならない（MUST）。Windows sandbox 由来の setup 失敗、未対応モード、sandbox backend 失敗も標準化エラーへ変換しなければならない（MUST）。

#### Scenario: SDK 失敗が UI で扱える形式になる
- **WHEN** OpenAI Codex TypeScript SDK 呼び出しが例外を返す
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Proxy 接続失敗が標準化エラーになる
- **WHEN** Proxy 接続に失敗して外部通信が確立できない
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Windows sandbox 失敗が標準化エラーになる
- **WHEN** Windows sandbox backend または setup 状態に起因する失敗が発生する
- **THEN** Main は Renderer が設定画面再表示に使える専用エラーコードを返す