## ADDED Requirements

### Requirement: ループイベントの Renderer 中継
システムは、Main プロセスで実行されるエージェントループの進行イベントを Renderer に逐次通知しなければならない（MUST）。通知には少なくともイベント種別とイベントに紐づく識別子（例: `toolCallId`）を含めなければならない（MUST）。

#### Scenario: ツール実行開始イベントが通知される
- **WHEN** Main のエージェント実行で `tool_execution_start` が発生する
- **THEN** Renderer へ同イベントが中継される

#### Scenario: ツール実行終了イベントが通知される
- **WHEN** Main のエージェント実行で `tool_execution_end` が発生する
- **THEN** Renderer へ同イベントが中継される

### Requirement: 実行終了時のイベントストリーム終端
システムは、エージェント実行が完了・失敗・中断のいずれで終了した場合でも、Renderer が進行中表示を確実に終了できる終端イベントまたは等価な終了通知を送出しなければならない（MUST）。

#### Scenario: 正常完了で終端通知が届く
- **WHEN** エージェント実行が正常完了する
- **THEN** Renderer は終端通知を受信できる

#### Scenario: 失敗時も終端通知が届く
- **WHEN** エージェント実行が失敗する
- **THEN** Renderer は終端通知を受信できる
