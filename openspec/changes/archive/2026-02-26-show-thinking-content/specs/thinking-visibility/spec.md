## ADDED Requirements

### Requirement: Thinking 増分イベントをループイベントとして配信できる
システムは、エージェント実行中に受信した `thinking_delta` を `agent:loopEvent` で renderer に逐次配信しなければならない（MUST）。この配信は既存イベント契約に後方互換で追加されなければならない（SHALL）。

#### Scenario: thinking 増分を受信した場合
- **WHEN** main プロセスが `message_update` で `assistantMessageEvent.type = "thinking_delta"` を受信する
- **THEN** 同一 `requestId` を持つ `thinking_delta` ループイベントが renderer に送信される

#### Scenario: thinking 非対応の応答の場合
- **WHEN** 実行中に `thinking_delta` が一度も発生しない
- **THEN** 既存の `run_start` / `tool_execution_*` / `run_end` イベント配信は従来どおり継続される

### Requirement: 実行中 assistant 表示に thinking 本文を段階表示できる
システムは、pending 状態の assistant メッセージ内で thinking 本文を増分反映しなければならない（SHALL）。thinking 本文は既存の進捗行（例: ツール開始表示）と同時に表示されなければならない（MUST）。表示は `Status / Thinking / Running command / 最終回答` を区別して可読に提示しなければならない（SHALL）。

#### Scenario: 実行中に thinking が流れる場合
- **WHEN** renderer が同一リクエストの `thinking_delta` を順次受信する
- **THEN** pending assistant メッセージの表示テキストへ受信順に追記される

#### Scenario: thinking と進捗行が混在する場合
- **WHEN** `thinking_delta` と `tool_execution_start` が同一実行中に発生する
- **THEN** pending assistant メッセージは両方の情報を保持して表示する

### Requirement: Thinking と command 表示は初期情報量を抑えて展開可能である
システムは、thinking 表示をデフォルトで折りたたみ、長文を先頭プレビューと追加展開で閲覧可能にしなければならない（SHALL）。command 詳細も同様に先頭プレビューと追加展開で表示しなければならない（SHALL）。

#### Scenario: thinking が長文の場合
- **WHEN** thinking 行数がプレビュー上限を超える
- **THEN** assistant 表示は先頭プレビューを表示し、残り行数を明示した展開UIで全文へアクセスできる

#### Scenario: command 詳細が長文の場合
- **WHEN** tool 詳細がプレビュー上限を超える
- **THEN** assistant 表示は先頭プレビューを表示し、残り行数を明示した展開UIで全文へアクセスできる

### Requirement: Thinking 開閉状態はセッション内再描画で維持される
システムは、ユーザーが操作した thinking セクションの開閉状態をセッション中に保持し、ストリーミング更新などの再描画後も維持しなければならない（MUST）。状態管理キーは requestId を優先し、requestId がない場合は message ID へフォールバックしなければならない（SHALL）。

#### Scenario: 再描画後も開閉状態を維持する場合
- **WHEN** ユーザーが thinking セクションを展開し、その後に `thinking_delta` が到着して再描画される
- **THEN** thinking セクションは展開状態のまま維持される

#### Scenario: requestId がある場合の状態キー
- **WHEN** `run_start` 後に pending assistant メッセージへ `requestId` が紐付いている
- **THEN** thinking 開閉状態は requestId キーで復元される

#### Scenario: requestId がない場合のフォールバック
- **WHEN** message に `requestId` が存在しない
- **THEN** thinking 開閉状態は message ID キーで維持される

### Requirement: 既存の submitPrompt 契約を維持する
システムは、thinking 可視化追加後も `submitPrompt` の成功/失敗レスポンス構造を変更してはならない（MUST NOT）。thinking 情報は loop event 経路でのみ提供されなければならない（SHALL）。

#### Scenario: thinking 可視化機能を有効化した場合
- **WHEN** renderer が `submitPrompt` の完了レスポンスを受信する
- **THEN** レスポンスのJSON構造は変更されず、追加データは `agent:loopEvent` に限定される
