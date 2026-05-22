## MODIFIED Requirements

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

## ADDED Requirements

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