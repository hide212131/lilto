## ADDED Requirements

### Requirement: `lilt-app` は起動時に App Server 会話一覧を hydrate する
システムは、`<lilt-app>` が DOM に接続されたとき、Main が公開する会話一覧 API から永続会話一覧を取得し、Renderer の session state を hydrate しなければならない（MUST）。App Server 側に履歴が存在しない場合でも、UI は空の待機状態として正常表示しなければならない（MUST）。

#### Scenario: 起動時に永続会話一覧が読み込まれる
- **WHEN** `<lilt-app>` が `connectedCallback` で初期化される
- **THEN** `window.lilto.listConversations()` が呼ばれ、返却された会話一覧が `sessions` に反映される

#### Scenario: 履歴 0 件でも待機状態で起動できる
- **WHEN** `window.lilto.listConversations()` が空配列を返す
- **THEN** `lilt-app` はエラーを表示せず、会話なしの待機状態で入力を受け付ける

### Requirement: `lilt-app` は送信前に永続会話を確保し、既存会話を再読込できる
システムは、未 bind の新規会話から最初の送信を行う前に永続会話を確保しなければならない（MUST）。また、履歴サイドバーから既存会話を開くときは Main の会話読込 API を使って本文を再読込しなければならない（MUST）。

#### Scenario: 初回送信前に会話が作成される
- **WHEN** 新規セッション状態でユーザーが最初のメッセージを送信する
- **THEN** `lilt-app` は送信前に `window.lilto.createConversation()` 相当の処理で永続会話を確保し、その ID に bind してから送信する

#### Scenario: 履歴から選択した会話本文を再読込できる
- **WHEN** ユーザーが履歴サイドバーで既存会話を選択する
- **THEN** `lilt-app` は `window.lilto.readConversation()` を呼び出し、永続会話の本文を `messages` に反映する

## MODIFIED Requirements

### Requirement: 新規セッション開始時の会話状態初期化
システムは、`lilt-app` が `new-session` イベントを受信したとき、現在表示している会話履歴と進行表示を初期化し、新しい入力を受け付け可能な待機状態へ遷移しなければならない（MUST）。この初期化は画面上の現在会話をリセットするものであり、既に App Server に永続化済みの会話履歴を削除してはならない（MUST NOT）。

#### Scenario: 既存会話表示をクリアして新規セッションに遷移する
- **WHEN** `isSending` が `false` の状態で `new-session` イベントを受信する
- **THEN** `messages` は空になり、`loopState` と進行表示関連の内部状態は初期値へ戻り、現在の会話 bind は解除される

#### Scenario: クリア後に新しい永続会話を開始できる
- **WHEN** 新規セッション開始後にユーザーが新しい入力を送信する
- **THEN** `lilt-app` は新しい永続会話を確保してからメッセージ履歴を先頭から生成する

#### Scenario: 新規セッション開始で既存履歴サイドバーは維持される
- **WHEN** ユーザーが `new-session` を実行する
- **THEN** 既存の App Server 永続会話は履歴サイドバーに残り、再度選択して開ける