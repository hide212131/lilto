## MODIFIED Requirements

### Requirement: Pi ai パッケージによる Claude OAuth 開始
システムは、Claude 利用開始時に Providers & Models 画面の Claude セクションから Pi の `ai` パッケージを使用して OAuth 認証フローを開始しなければならない（MUST）。

#### Scenario: Providers & Models 上の認証操作で OAuth が始まる
- **WHEN** ユーザーが Settings の `Providers & Models` で Claude の認証開始アクションを実行する
- **THEN** Main は Pi `ai` パッケージ経由で Claude OAuth 開始処理を呼び出す

### Requirement: 認証進行状態の UI 反映
システムは、OAuth の進行状態（認証中・成功・失敗）を Renderer に通知し、Providers & Models 画面とチャット送信可否の双方へ反映しなければならない（MUST）。

#### Scenario: 認証状態が Providers & Models に表示される
- **WHEN** OAuth 状態が未認証から認証中または認証済みに変化する
- **THEN** Renderer の Claude セクション表示が対応する認証ステータスへ更新される

#### Scenario: 認証成功で Claude 経路が送信可能になる
- **WHEN** OAuth が成功してトークン保存が完了し、現在 provider が Claude である
- **THEN** チャット送信操作が有効化され、追加設定なしで問い合わせを送信できる
