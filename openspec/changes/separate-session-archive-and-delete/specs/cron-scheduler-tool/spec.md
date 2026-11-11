## ADDED Requirements

### Requirement: スケジュールが参照する会話は archive／delete できない
システムは、保持されているスケジュール（cron・one_shot）の通知先 `sessionId` が参照する会話について、archive と delete を拒否しなければならない（MUST）。Main は操作の都度、最新のスケジュール一覧で再検証しなければならず、一覧の取得に失敗した場合も操作を拒否しなければならない（MUST）。スケジュールを自動で削除してはならない（MUST NOT）。

#### Scenario: スケジュール参照ありは拒否する
- **WHEN** 対象会話を参照するスケジュールが存在する状態で archive／delete が要求される
- **THEN** Main は `CONVERSATION_HAS_SCHEDULES` を返し、App Server を呼ばない

#### Scenario: スケジュール確認に失敗した
- **WHEN** スケジュール一覧の取得が失敗する
- **THEN** Main は `CONVERSATION_SCHEDULE_CHECK_FAILED` を返し、App Server を呼ばない
