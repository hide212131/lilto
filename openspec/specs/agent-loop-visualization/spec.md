# agent-loop-visualization Specification

## Purpose
TBD - created by archiving change visualize-agent-loop-ui. Update Purpose after archive.
## Requirements
### Requirement: 実行中ループ状態の可視化
システムは、エージェント実行中の状態を UI 上でリアルタイムに可視化し、少なくとも「思考中」「ツール実行中」「完了」「失敗」を識別可能に表示しなければならない（MUST）。

#### Scenario: 実行開始で進行中ステータスが表示される
- **WHEN** ユーザーがプロンプト送信後、エージェントループが開始される
- **THEN** UI は処理中を示すステータスを表示する

#### Scenario: 実行完了でステータスが完了へ遷移する
- **WHEN** エージェント実行が正常終了する
- **THEN** UI は進行中表示を終了し、完了状態へ遷移する

#### Scenario: 実行失敗でエラー状態が表示される
- **WHEN** エージェント実行が失敗または中断される
- **THEN** UI は失敗状態を表示し、進行中表示をクリアする

### Requirement: 実行中ツール一覧の表示
システムは、`tool_execution_start` / `tool_execution_end` に基づいて現在実行中のツール一覧を表示しなければならない（MUST）。

#### Scenario: ツール開始時に一覧へ追加される
- **WHEN** `tool_execution_start` イベントを受信する
- **THEN** 対応するツール名が「実行中ツール」一覧に追加される

#### Scenario: ツール終了時に一覧から除去される
- **WHEN** 対応する `tool_execution_end` イベントを受信する
- **THEN** 該当ツールが「実行中ツール」一覧から除去される

### Requirement: ツールの実行内容は既定で非表示にし、設定で切り替えられる
システムは、途中経過メッセージ内のツール実行内容（コマンドや引数）を既定で表示してはならない（MUST NOT）。Chat 設定で表示を有効にした場合は、ツール実行内容を表示しなければならない（MUST）。ツール名と進行状況は設定にかかわらず表示しなければならない（MUST）。

#### Scenario: 既定ではツール実行内容を隠す
- **WHEN** ユーザーがツール詳細の表示設定を変更していない
- **THEN** 途中経過メッセージにはツール名と進行状況が表示され、コマンドや引数は表示されない

#### Scenario: Chat 設定でツール実行内容を表示する
- **WHEN** ユーザーが Chat 設定でツール実行内容の表示を有効にする
- **THEN** 途中経過メッセージにツール名・進行状況とともにコマンドや引数が表示される

