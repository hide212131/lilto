# agent-bridge Specification

## Purpose
TBD - created by archiving change initial-agent-scaffold. Update Purpose after archive.
## Requirements
### Requirement: テキスト要求の受け渡し
システムは、Renderer で入力されたテキスト要求を Main に転送し、`pi-coding-agent` SDK 実行へ渡さなければならない（MUST）。

#### Scenario: プロンプトを送信して実行する
- **WHEN** ユーザーが UI からテキストを送信する
- **THEN** Main が受信した要求を `pi-coding-agent` SDK に渡して処理を開始する

### Requirement: 応答の返却
システムは、エージェント実行結果を Renderer に返し、ユーザーが UI 上で確認できるようにしなければならない（MUST）。

#### Scenario: 実行結果が表示される
- **WHEN** `pi-coding-agent` SDK の処理が完了する
- **THEN** Main は結果を Renderer に返し、UI に応答が表示される

### Requirement: 失敗時のエラー応答
システムは、エージェント実行が失敗した場合に標準化されたエラー情報を Renderer に返さなければならない（MUST）。

#### Scenario: 実行失敗時にユーザーへ通知される
- **WHEN** `pi-coding-agent` SDK が例外を返す
- **THEN** Renderer は失敗理由を含むエラーメッセージを表示する

### Requirement: CLI 別プロセスを実行しない
システムは、エージェント要求の通常実行経路として `pi-coding-agent` CLI を別プロセスで直接起動してはならない（MUST NOT）。

#### Scenario: 実行経路が SDK に固定される
- **WHEN** Renderer からテキスト要求が届く
- **THEN** Main は SDK API を使って実行し、CLI プロセス起動を行わない

