## MODIFIED Requirements

### Requirement: Providers & Models 設定画面の提供
システムは、Settings モーダル内の設定メニューを `Providers & Models` として提供し、Claude と Custom Provider の設定導線を同一画面で提示しなければならない（MUST）。また同一画面でネットワーク Proxy 設定導線を提示しなければならない（MUST）。さらに OAuth Provider 選択導線を提示し、`anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity` のいずれかを選択可能にしなければならない（MUST）。

#### Scenario: 設定メニューが Providers & Models へ置き換わる
- **WHEN** ユーザーが Settings モーダルを開く
- **THEN** メニュー項目は `Claude Auth` ではなく `Providers & Models` を表示する

#### Scenario: Claude と Custom Provider の両セクションが表示される
- **WHEN** ユーザーが `Providers & Models` を選択する
- **THEN** Claude OAuth 設定セクションと Custom Provider 設定セクションが同一画面に表示される

#### Scenario: Proxy 設定セクションが表示される
- **WHEN** ユーザーが `Providers & Models` を選択する
- **THEN** HTTP/HTTPS/NO_PROXY を入力できる Proxy 設定セクションが同一画面に表示される

#### Scenario: OAuth Provider の候補を選択できる
- **WHEN** ユーザーが `Providers & Models` を開く
- **THEN** OAuth Provider の選択 UI が表示され、`anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity` のいずれかを選択できる

#### Scenario: OAuth Provider 選択を保存して復元できる
- **WHEN** ユーザーが OAuth Provider を変更して保存操作を実行する
- **THEN** システムは選択値を永続化し、次回起動後も同じ OAuth Provider を復元する

### Requirement: Provider 別の実行可否表示
システムは、現在選択されている provider の準備状態に応じて、送信可否と不足条件を UI へ表示しなければならない（MUST）。OAuth provider を使用する経路では、選択中 OAuth provider の認証状態を評価対象にしなければならない（MUST）。

#### Scenario: Claude 未認証時に不足条件を表示する
- **WHEN** 現在 provider が Claude で、選択中 OAuth provider の認証が未完了の状態である
- **THEN** UI は送信を無効化し、選択中 OAuth provider の認証が必要である旨を表示する

#### Scenario: Custom Provider 未設定時に不足条件を表示する
- **WHEN** 現在 provider が Custom Provider で必須設定が未完了である
- **THEN** UI は送信を無効化し、不足している設定項目を表示する

#### Scenario: OAuth Provider 変更後に不足条件表示が切り替わる
- **WHEN** ユーザーが OAuth Provider を変更して保存し、まだ新しい provider の認証が完了していない
- **THEN** UI は旧 provider の認証状態に関わらず未認証として扱い、送信不可メッセージを更新する
