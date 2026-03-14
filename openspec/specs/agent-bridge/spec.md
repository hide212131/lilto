# agent-bridge Specification

## Purpose
Renderer の入力要求を Main 側の現行エージェント runtime へ橋渡しし、結果と失敗を UI に返す。

## Requirements
### Requirement: テキスト要求の受け渡し
システムは、Renderer で入力されたテキスト要求を Main に転送し、`AgentRuntime` を通じて OpenAI Codex TypeScript SDK ベースの実行へ渡さなければならない（MUST）。

#### Scenario: プロンプトを送信して実行する
- **WHEN** ユーザーが UI からテキストを送信する
- **THEN** Main が受信した要求を `AgentRuntime` に渡して処理を開始する

### Requirement: 応答の返却
システムは、エージェント実行結果を Renderer に返し、ユーザーが UI 上で確認できるようにしなければならない（MUST）。

#### Scenario: 実行結果が表示される
- **WHEN** Codex runtime の処理が完了する
- **THEN** Main は結果を Renderer に返し、UI に応答が表示される

### Requirement: 失敗時のエラー応答
システムは、エージェント実行が失敗した場合に標準化されたエラー情報を Renderer に返さなければならない（MUST）。

#### Scenario: 実行失敗時にユーザーへ通知される
- **WHEN** Codex runtime が例外または失敗イベントを返す
- **THEN** Renderer は失敗理由を含むエラーメッセージを表示する

### Requirement: Renderer は runtime 実装詳細に依存しない
システムは、エージェント要求の通常実行経路において、Renderer が Codex SDK やその内部実装詳細へ直接依存してはならない（MUST NOT）。実行の開始・継続・失敗変換は Main 側の `AgentRuntime` に集約しなければならない（MUST）。

#### Scenario: 実行経路が Main に固定される
- **WHEN** Renderer からテキスト要求が届く
-- **THEN** Main は `AgentRuntime` を使って実行し、Renderer は runtime 実装詳細を意識しない

