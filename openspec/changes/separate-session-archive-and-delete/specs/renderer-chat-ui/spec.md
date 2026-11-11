## MODIFIED Requirements

### Requirement: 会話履歴から永続会話を再開し、rename と archive を実行できる
システムは、会話履歴サイドバーから永続会話の選択、rename、archive、delete（本 Requirement 名の「archive」は archive と delete の両方を含む）を行えなければならない（MUST）。これらの操作は Renderer 単独で完結してはならず（MUST NOT）、Main の IPC を通じて永続状態へ反映されなければならない（MUST）。メニューは「名称変更」「アーカイブ」「削除」の順で、削除のみ危険色とし、各項目は button 要素でなければならない（MUST）。heartbeat assistant のローカルセッションにはメニューを表示してはならない（MUST NOT）。アクティビティ表示にはメニューを追加しない。

#### Scenario: 履歴クリックで永続会話を再開する
- **WHEN** ユーザーが履歴サイドバーの会話行をクリックする
- **THEN** システムは Main から会話本文を再取得し、選択会話をメイン画面に表示する

#### Scenario: rename が永続会話へ反映される
- **WHEN** ユーザーが履歴サイドバーから会話タイトルを変更する
- **THEN** システムは Main の rename API を呼び出し、更新後タイトルを一覧と再読込結果の両方に反映する

#### Scenario: archive は確認なしで一覧から除外される
- **WHEN** ユーザーが履歴サイドバーで「アーカイブ」を選ぶ
- **THEN** システムは確認を出さずに Main の archive API を呼び出し、成功後に対象会話を通常一覧から除外する

#### Scenario: delete は確認後にだけ実行される
- **WHEN** ユーザーが「削除」を選ぶ
- **THEN** システムは `globalThis.confirm` で対象タイトル付きの確認を表示する
- **AND** キャンセルされた場合は IPC を呼ばず、エラー表示も出さない
- **AND** 承認された場合は Main の delete API を呼び出し、成功後に対象会話を一覧から除外する

#### Scenario: 実行中・スケジュール参照ありは拒否する
- **WHEN** 対象会話が実行中、またはスケジュールから参照されている状態で archive／delete を選ぶ
- **THEN** システムは操作を実行せず、理由を失敗表示に示す

#### Scenario: 失敗はサイドバー上部に表示する
- **WHEN** archive／delete が拒否または失敗する（IPC の rejection を含む）
- **THEN** システムはサイドバー上部の `role="alert"` 領域に「「{タイトル}」を{アーカイブ／削除}できません: {理由}（{code}）」を表示する
- **AND** 閉じる操作を提供し、自動では消さない

#### Scenario: 成功後の状態整理
- **WHEN** archive／delete が成功する
- **THEN** システムは一覧・下書き・プレビュー・loop 状態から対象を除去する
- **AND** 表示中だった場合はメッセージを空にして未選択状態へ戻し、対象の下書きが再保存されないようにする
- **AND** 表示中でない場合は現在の会話と入力内容を変更しない
