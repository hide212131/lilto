## MODIFIED Requirements

### Requirement: lilt-top-bar コンポーネント
システムは、トップバーを `<lilt-top-bar>` コンポーネントとして実装し、アプリ名・ステータス表示・設定ボタン・新規セッション開始ボタン（＋）を含まなければならない（MUST）。新規セッション開始ボタンはクリック時に `new-session` カスタムイベントを発火しなければならない（MUST）。また、送信中は新規セッション開始ボタンを無効化できなければならない（MUST）。

#### Scenario: ステータスが送信状態に応じて変わる
- **WHEN** `isSending` が `true` の状態で `<lilt-top-bar>` が描画される
- **THEN** ステータス表示が「送信中...」になる

#### Scenario: 設定ボタンクリックでイベントが発火する
- **WHEN** ユーザーが設定ボタン（⚙）をクリックする
- **THEN** `open-settings` カスタムイベントが発火する

#### Scenario: 新規セッションボタンクリックでイベントが発火する
- **WHEN** ユーザーが新規セッション開始ボタン（＋）をクリックする
- **THEN** `new-session` カスタムイベントが発火する

#### Scenario: 送信中は新規セッションボタンが無効化される
- **WHEN** `isSending` が `true` の状態で `<lilt-top-bar>` が描画される
- **THEN** 新規セッション開始ボタンは `disabled` になり、`new-session` イベントを発火しない

## ADDED Requirements

### Requirement: 新規セッション開始時の会話状態初期化
システムは、`lilt-app` が `new-session` イベントを受信したとき、現在の会話履歴と進行表示を初期化し、新しい入力を受け付け可能な待機状態へ遷移しなければならない（MUST）。

#### Scenario: 既存会話をクリアして新規セッションに遷移する
- **WHEN** `isSending` が `false` の状態で `new-session` イベントを受信する
- **THEN** `messages` は空になり、`loopState` と進行表示関連の内部状態は初期値へ戻る

#### Scenario: クリア後に新しい会話を開始できる
- **WHEN** 新規セッション開始後にユーザーが新しい入力を送信する
- **THEN** 新しい会話としてメッセージ履歴が先頭から生成される
