## MODIFIED Requirements

### Requirement: 認証済み状態での問い合わせ応答
システムは、現在選択されている provider の準備完了状態で問い合わせを受理し、provider に応じた SDK 実行結果を構造化応答として Renderer に返却しなければならない（MUST）。

#### Scenario: Claude が選択され認証済みなら応答テキストが返る
- **WHEN** provider が Claude かつ OAuth 認証済みのユーザーが質問を送信する
- **THEN** Main は Claude 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Custom Provider が選択され設定済みなら応答テキストが返る
- **WHEN** provider が Custom Provider（OpenAI Completions Compatible）で必要設定が完了したユーザーが質問を送信する
- **THEN** Main は Custom Provider 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

### Requirement: 未認証時の実行拒否
システムは、現在選択されている provider の前提条件が未完了の場合に問い合わせ実行を拒否し、不足条件を示すエラーを返さなければならない（MUST）。

#### Scenario: Claude 未認証の送信が拒否される
- **WHEN** provider が Claude で OAuth 未完了のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、Claude 認証が必要であることを示すエラーコードを返す

#### Scenario: Custom Provider 未設定の送信が拒否される
- **WHEN** provider が Custom Provider で `baseUrl` など必須設定が不足した状態で質問を送信する
- **THEN** Main は問い合わせを実行せず、不足設定を示すエラーコードを返す
