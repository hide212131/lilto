## MODIFIED Requirements

### Requirement: Pi ai パッケージによる Claude OAuth 開始
システムは、OAuth 利用開始時に Providers & Models 画面の Claude セクションから Pi の `ai` パッケージを使用して OAuth 認証フローを開始しなければならない（MUST）。また OAuth 開始時は設定済み OAuth provider（`anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity`）を指定して provider 解決を行わなければならない（MUST）。

#### Scenario: Providers & Models 上の認証操作で OAuth が始まる
- **WHEN** ユーザーが Settings の `Providers & Models` で Claude の認証開始アクションを実行する
- **THEN** Main は Pi `ai` パッケージ経由で、設定済み OAuth provider を指定した OAuth 開始処理を呼び出す

#### Scenario: 未対応 OAuth provider は識別可能な失敗になる
- **WHEN** 保存された OAuth provider が実行時に解決できず OAuth 開始処理を実行する
- **THEN** システムは provider 名を含む失敗理由を返し、ユーザーに再設定または再試行の導線を提示する

### Requirement: 認証進行状態の UI 反映
システムは、OAuth の進行状態（認証中・成功・失敗）を Renderer に通知し、Providers & Models 画面とチャット送信可否の双方へ反映しなければならない（MUST）。認証状態は選択中 OAuth provider 単位で扱い、provider 不一致の資格情報を認証済みとして扱ってはならない（MUST）。

#### Scenario: 認証状態が Providers & Models に表示される
- **WHEN** 選択中 OAuth provider の状態が未認証から認証中または認証済みに変化する
- **THEN** Renderer の Claude セクション表示が対応する認証ステータスへ更新される

#### Scenario: 認証成功で Claude 経路が送信可能になる
- **WHEN** 選択中 OAuth provider で OAuth が成功してトークン保存が完了し、現在 provider が Claude である
- **THEN** チャット送信操作が有効化され、追加設定なしで問い合わせを送信できる

### Requirement: 認証成功後の即時チャット可能化
システムは、OAuth 成功後に取得したトークンを現在セッションで再利用し、追加設定なしでチャット送信可能にしなければならない（MUST）。

#### Scenario: 認証直後に質問できる
- **WHEN** 選択中 OAuth provider で OAuth が成功してトークン保存が完了する
- **THEN** ユーザーは同一画面でそのまま質問送信でき、Main が問い合わせ実行を受理する

### Requirement: 認証失敗時の再試行導線
システムは、OAuth が失敗またはタイムアウトした場合、失敗理由と再試行アクションを UI で提示しなければならない（MUST）。

#### Scenario: 失敗後に再認証できる
- **WHEN** OAuth 完了前にエラーまたはタイムアウトが発生する
- **THEN** Renderer は失敗メッセージと再試行ボタンを表示する
