# claude-oauth-chat-bootstrap Specification

## Purpose
TBD - created by archiving change add-pi-sdk-main-process-agent. Update Purpose after archive.
## Requirements
### Requirement: Pi ai パッケージによる Claude OAuth 開始
システムは、Claude 利用開始時に Pi の `ai` パッケージを使用して OAuth 認証フローを開始しなければならない（MUST）。

#### Scenario: 認証開始操作で OAuth が始まる
- **WHEN** ユーザーが UI の認証開始アクションを実行する
- **THEN** Main は Pi `ai` パッケージ経由で Claude OAuth 開始処理を呼び出す

### Requirement: 認証進行状態の UI 反映
システムは、OAuth の進行状態（認証中・成功・失敗）を Renderer に通知し、UI で視認可能にしなければならない（MUST）。

#### Scenario: 認証状態が画面に表示される
- **WHEN** OAuth 状態が未認証から認証中または認証済みに変化する
- **THEN** Renderer の状態表示が対応する認証ステータスへ更新される

### Requirement: 認証成功後の即時チャット可能化
システムは、OAuth 成功後に取得したトークンを現在セッションで再利用し、追加設定なしでチャット送信可能にしなければならない（MUST）。

#### Scenario: 認証直後に質問できる
- **WHEN** OAuth が成功してトークン保存が完了する
- **THEN** ユーザーは同一画面でそのまま質問送信でき、Main が問い合わせ実行を受理する

### Requirement: 認証失敗時の再試行導線
システムは、OAuth が失敗またはタイムアウトした場合、失敗理由と再試行アクションを UI で提示しなければならない（MUST）。

#### Scenario: 失敗後に再認証できる
- **WHEN** OAuth 完了前にエラーまたはタイムアウトが発生する
- **THEN** Renderer は失敗メッセージと再試行ボタンを表示する

