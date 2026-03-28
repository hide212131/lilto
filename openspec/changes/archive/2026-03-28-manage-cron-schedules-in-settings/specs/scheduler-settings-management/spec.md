## ADDED Requirements

### Requirement: Settings から有効な schedule 一覧を確認できる
システムは、Settings 内の schedule 管理 UI から有効な schedule 一覧を取得し、各項目の識別に必要な情報を表示しなければならない（MUST）。各 schedule には少なくとも ID、種別、次回実行時刻または実行条件、通知メッセージを表示しなければならない（MUST）。一覧取得に失敗した場合、UI は空状態として誤表示してはならず、失敗状態を明示しなければならない（MUST NOT / MUST）。

#### Scenario: Settings で schedule 一覧が表示される
- **WHEN** ユーザーが Settings の `Schedules` タブを開く
- **THEN** システムは有効な schedule 一覧を取得し、各項目について ID、種別、次回実行時刻または実行条件、通知メッセージを表示する

#### Scenario: schedule が存在しないとき空状態を表示する
- **WHEN** ユーザーが `Schedules` タブを開き、有効な schedule が 0 件である
- **THEN** システムは schedule が存在しない旨の空状態メッセージを表示する

#### Scenario: 一覧取得失敗を状態文言で表示する
- **WHEN** ユーザーが `Schedules` タブを開いたときに一覧取得が失敗する
- **THEN** システムは失敗理由を Settings 内へ表示し、成功時の空状態と区別できるようにする

### Requirement: Settings から不要な schedule を削除できる
システムは、Settings の schedule 一覧から任意の schedule を削除できなければならない（MUST）。削除成功後は一覧表示を再同期し、削除済み schedule を残したままにしてはならない（MUST NOT）。削除失敗時は対象 schedule を消したように見せてはならず、失敗状態を表示しなければならない（MUST NOT / MUST）。

#### Scenario: schedule を削除すると一覧から消える
- **WHEN** ユーザーが一覧内の schedule に対して削除操作を実行し、削除が成功する
- **THEN** システムは一覧を再取得し、削除した schedule を表示しない

#### Scenario: 削除失敗時は項目を残してエラーを表示する
- **WHEN** ユーザーが schedule の削除操作を実行したが、scheduler 側で削除に失敗する
- **THEN** システムは対象 schedule を一覧に残し、削除失敗の状態文言を表示する