# renderer-chat-ui Specification

## Purpose
TBD - created by archiving change build-renderer-chat-ui-and-ui-guidelines. Update Purpose after archive.
## Requirements
### Requirement: チャット形式でのテキスト送受信
システムは、Renderer UI でユーザー入力テキストを送信し、Main から返却された応答テキストを会話形式で表示しなければならない（MUST）。

#### Scenario: ユーザー送信と応答が同一会話に表示される
- **WHEN** ユーザーが入力欄にテキストを入力して送信する
- **THEN** UI は送信テキストと応答テキストを時系列のメッセージとして表示する

### Requirement: 送信中状態の可視化
システムは、リクエスト送信中に重複送信を防ぎつつ、処理中であることを UI 上で明示しなければならない（MUST）。

#### Scenario: 応答待機中に状態が更新される
- **WHEN** ユーザー送信後に Main からの応答を待機している
- **THEN** UI は送信中状態を表示し、応答受信または失敗時に通常状態へ戻る

### Requirement: 失敗時の再送可能な表示
システムは、問い合わせ失敗時にエラー内容を会話コンテキスト内で表示し、ユーザーが再送できる状態を維持しなければならない（MUST）。

#### Scenario: エラー発生後に再送できる
- **WHEN** Main から失敗レスポンスが返る
- **THEN** UI は失敗理由を表示し、入力欄と送信操作を再び利用可能にする

### Requirement: セッション一覧は会話更新順で表示される
システムは、会話履歴の一覧を Main が返す App Server 永続会話の `updatedAt` が新しい順に表示しなければならない（MUST）。Renderer は会話一覧の正として独自の `localStorage` を使ってはならず（MUST NOT）、Main から返る永続会話一覧を基準に表示しなければならない（MUST）。

#### Scenario: 起動時に永続会話が更新順で並ぶ
- **WHEN** Main から複数の永続会話が `updatedAt` 付きで返る
- **THEN** 会話履歴は `updatedAt` 降順で表示される

#### Scenario: バックグラウンド更新されたセッションが先頭へ移動する
- **WHEN** 現在表示していないセッションに cron 通知または長時間推論の結果メッセージが追加される
- **THEN** 会話履歴はそのセッションを一覧の先頭へ移動して表示する

#### Scenario: legacy localStorage 履歴は移行せず無視する
- **WHEN** renderer 側に旧来の会話 `localStorage` が残っているが、Main が別の永続会話一覧または空配列を返す
- **THEN** システムは Main が返した結果だけを表示し、legacy localStorage を会話一覧へ混ぜない

### Requirement: 非表示セッションの新着会話は未読として示される
システムは、メイン画面に表示していないセッションへ新しい会話内容が到着した場合、そのセッションを未読として識別できる表示を会話履歴に出さなければならない（MUST）。

#### Scenario: 非表示セッションに新着会話が届く
- **WHEN** 現在アクティブではないセッションへ assistant、system、または error のメッセージが追加または更新される
- **THEN** 会話履歴の該当セッション行の右端に青い未読マークを表示する

#### Scenario: 未読セッションを開くと既読になる
- **WHEN** ユーザーが未読マーク付きのセッションをクリックしてその会話をメイン画面に表示する
- **THEN** システムはそのセッションの未読状態を解除し、未読マークを消す

#### Scenario: 表示中セッションには未読マークを付けない
- **WHEN** 現在メイン画面に表示しているセッションで会話内容が更新される
- **THEN** システムはそのセッションを未読として表示しない

### Requirement: 会話履歴から永続会話を再開し、rename と archive を実行できる
システムは、会話履歴サイドバーから永続会話の選択、rename、archive を行えなければならない（MUST）。これらの操作は Renderer 単独で完結してはならず（MUST NOT）、Main の IPC を通じて永続状態へ反映されなければならない（MUST）。

#### Scenario: 履歴クリックで永続会話を再開する
- **WHEN** ユーザーが履歴サイドバーの会話行をクリックする
- **THEN** システムは Main から会話本文を再取得し、選択会話をメイン画面に表示する

#### Scenario: rename が永続会話へ反映される
- **WHEN** ユーザーが履歴サイドバーから会話タイトルを変更する
- **THEN** システムは Main の rename API を呼び出し、更新後タイトルを一覧と再読込結果の両方に反映する

#### Scenario: archive 後は一覧から除外される
- **WHEN** ユーザーが履歴サイドバーから会話の削除相当操作を行う
- **THEN** システムは Main の archive API を呼び出し、対象会話を通常一覧から除外する

