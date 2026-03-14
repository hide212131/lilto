## MODIFIED Requirements

### Requirement: Pi ai パッケージによる Claude OAuth 開始
システムは、OAuth 利用開始時に Providers & Models 画面の認証セクションから、Pi の `ai` パッケージではなく OpenAI Codex TypeScript SDK に対応した認証フローを開始しなければならない（MUST）。認証開始時は lilto が管理する Codex 実行用の認証設定を解決しなければならない（MUST）。

#### Scenario: Providers & Models 上の認証操作で Codex 認証が始まる
- **WHEN** ユーザーが Settings の `Providers & Models` で認証開始アクションを実行する
- **THEN** Main は Codex SDK に対応した認証開始処理を呼び出す

#### Scenario: 認証設定を解決できない場合は識別可能な失敗になる
- **WHEN** 実行時に必要な Codex 認証設定を解決できず認証開始処理を実行する
- **THEN** システムは不足設定を含む失敗理由を返し、ユーザーに再試行の導線を提示する

#### Scenario: API key 方式では OAuth を開始しない
- **WHEN** 認証方式が API key に設定されている
- **THEN** システムは認証開始ボタン経由の OAuth 処理を要求せず、API key 入力導線を案内する

### Requirement: 認証進行状態の UI 反映
システムは、Codex 認証の進行状態（認証中・成功・失敗）を Renderer に通知し、Providers & Models 画面とチャット送信可否の双方へ反映しなければならない（MUST）。ブラウザ OAuth と API key のいずれを選んでいるかを含めて、選択中方式の Codex 実行可否として扱わなければならない（MUST）。

#### Scenario: 認証状態が Providers & Models に表示される
- **WHEN** Codex 認証の状態が未認証から認証中または認証済みに変化する
- **THEN** Renderer の認証セクション表示が対応する認証ステータスへ更新される

#### Scenario: 認証成功で送信可能になる
- **WHEN** Codex 認証が成功して資格情報保存が完了する
- **THEN** チャット送信操作が有効化され、追加設定なしで問い合わせを送信できる

### Requirement: 認証成功後の即時チャット可能化
システムは、Codex 認証成功後に取得した資格情報を現在セッションで再利用し、追加設定なしでチャット送信可能にしなければならない（MUST）。

#### Scenario: 認証直後に質問できる
- **WHEN** Codex 認証が成功して資格情報保存が完了する
- **THEN** ユーザーは同一画面でそのまま質問送信でき、Main が問い合わせ実行を受理する

### Requirement: 認証失敗時の再試行導線
システムは、認証が失敗またはタイムアウトした場合、失敗理由と再試行アクションを UI で提示しなければならない（MUST）。

#### Scenario: 失敗後に再認証できる
- **WHEN** 認証完了前にエラーまたはタイムアウトが発生する
- **THEN** Renderer は失敗メッセージと再試行ボタンを表示する
