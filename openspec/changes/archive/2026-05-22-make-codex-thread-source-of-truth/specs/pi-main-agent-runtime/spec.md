## MODIFIED Requirements

### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で Codex App Server を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、Codex App Server 起動時には Electron 親プロセスの生 `process.env` をそのまま使うのではなく、Codex 実行向けに正規化・補完した environment を子プロセスへ渡さなければならない（MUST）。Windows では `PATH` を含む標準環境変数を persistent な User/Machine 環境から補完できなければならず（MUST）、補完後も `CODEX_HOME`、packaged Codex binary path、bridge 用 env など lilto 管理 override が優先されなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、Codex App Server の current schema に整合する sandbox 設定を使って thread と turn を開始し、Windows sandbox backend が選択可能な起動条件を満たさなければならない（MUST）。

#### Scenario: Main で Codex App Server が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は Codex App Server を介して thread を開始または再開し、turn 実行を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要なローカルコマンド実行を行う
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

#### Scenario: Electron 起動時でも Codex 用 environment が正規化される
- **WHEN** Electron が Explorer など対話 shell 外の起動元から開始され、`process.env` の `PATH` や標準環境変数が対話 shell と一致しない可能性がある
- **THEN** Main は Codex 起動前に environment を正規化し、補完済みの `PATH` と必要な標準変数を App Server 子プロセスへ渡す

#### Scenario: environment 補完失敗時は既存経路へフォールバックする
- **WHEN** Windows の persistent environment 解決に失敗する
- **THEN** Main は失敗をログへ残しつつ、既存の `process.env` ベース環境と明示 override を使って Codex 起動を継続する

#### Scenario: Windows sandbox 有効時は App Server schema に整合する sandbox で起動する
- **WHEN** Windows 上で保存済み Windows sandbox モードが `unelevated` または `elevated` である
- **THEN** Main は thread/start と turn/start の両方で App Server schema に整合する sandbox 設定を渡して実行する

### Requirement: 認証済み状態での問い合わせ応答
システムは、選択中の Codex 認証方式で実行に必要な認証が完了した状態で問い合わせを受理し、Codex App Server の実行結果を構造化応答として Renderer に返却しなければならない（MUST）。また、外部通信が必要な Codex 実行では Proxy 設定を考慮した経路で処理しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、セットアップ完了済みの sandbox 実行経路を通しても同じ応答契約を維持しなければならない（MUST）。

#### Scenario: Codex 認証済みなら応答テキストが返る
- **WHEN** Codex 認証済みのユーザーが質問を送信する
- **THEN** Main は Codex App Server 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: API key 設定済みなら応答テキストが返る
- **WHEN** 認証方式が API key で、有効な Codex API key が保存されたユーザーが質問を送信する
- **THEN** Main は保存済み API key を使って Codex App Server 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Proxy 必須環境でも設定済みなら応答テキストが返る
- **WHEN** 実行環境が Proxy 経由でのみ外部接続可能で、必要な Proxy 設定が保存されている
- **THEN** Main は問い合わせを成功させ、応答を `promptResult` として Renderer に返す

#### Scenario: Windows sandbox 経由でも応答契約を維持する
- **WHEN** Windows sandbox モードが有効で setup 完了済みの状態でユーザーが質問を送信する
- **THEN** Main は sandboxed App Server thread 経由で処理し、通常実行と同じ `promptResult` 契約で応答を返す

### Requirement: 実行失敗時の標準化エラー
システムは、Codex App Server 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。Proxy 経路の接続失敗も同じ標準化エラー形式で返さなければならない（MUST）。Windows sandbox 由来の setup 失敗、未対応モード、sandbox backend 失敗も標準化エラーへ変換しなければならない（MUST）。

#### Scenario: App Server 失敗が UI で扱える形式になる
- **WHEN** Codex App Server request または turn 実行が失敗する
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Proxy 接続失敗が標準化エラーになる
- **WHEN** Proxy 接続に失敗して外部通信が確立できない
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Windows sandbox 失敗が標準化エラーになる
- **WHEN** Windows sandbox の setup 失敗、未対応モード、または backend 実行失敗が発生する
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Windows sandbox setup 必須エラーが設定画面向けに返る
- **WHEN** Windows sandbox モード有効中に setup 未完了のまま問い合わせが送信される
- **THEN** Main は Renderer が設定画面再表示に使える専用エラーコードを返す

## ADDED Requirements

### Requirement: 会話履歴は Main 側の App Server サービスで管理される
システムは、会話一覧取得、会話詳細取得、会話作成、rename、archive を Main 側の App Server サービスで処理しなければならない（MUST）。会話履歴で使う識別子は App Server の永続 thread ID を正としなければならない（MUST）。履歴一覧は lilto 管理 `CODEX_HOME` 上の実データを取りこぼさない source filter で取得しなければならない（MUST）。

#### Scenario: 起動時に永続会話一覧を返せる
- **WHEN** Renderer が起動直後に会話一覧取得を要求する
- **THEN** Main は App Server の永続 thread 一覧から会話 ID、タイトル、作成時刻、更新時刻を返す

#### Scenario: 初回送信前に永続会話を確保する
- **WHEN** Renderer が未 bind の新規会話から最初の送信を行う
- **THEN** Main は App Server 側で会話を作成し、その永続 thread ID を以後の送信と履歴操作に使う

#### Scenario: 会話 rename と archive が永続化される
- **WHEN** Renderer が会話タイトル変更または削除相当の操作を行う
- **THEN** Main は App Server の `thread/name/set` または `thread/archive` を呼び出して永続状態を更新する

#### Scenario: 再起動後も同じ会話一覧を再取得できる
- **WHEN** アプリ再起動後に Renderer が会話一覧を要求する
- **THEN** Main は前回セッションで作成された App Server 永続会話を同じ ID で再取得できる