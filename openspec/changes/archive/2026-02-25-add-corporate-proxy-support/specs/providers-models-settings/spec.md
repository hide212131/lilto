## MODIFIED Requirements

### Requirement: Providers & Models 設定画面の提供
システムは、Settings モーダル内の設定メニューを `Providers & Models` として提供し、Claude と Custom Provider の設定導線を同一画面で提示しなければならない（MUST）。また同一画面でネットワーク Proxy 設定導線を提示しなければならない（MUST）。

#### Scenario: 設定メニューが Providers & Models へ置き換わる
- **WHEN** ユーザーが Settings モーダルを開く
- **THEN** メニュー項目は `Claude Auth` ではなく `Providers & Models` を表示する

#### Scenario: Claude と Custom Provider の両セクションが表示される
- **WHEN** ユーザーが `Providers & Models` を選択する
- **THEN** Claude OAuth 設定セクションと Custom Provider 設定セクションが同一画面に表示される

#### Scenario: Proxy 設定セクションが表示される
- **WHEN** ユーザーが `Providers & Models` を選択する
- **THEN** HTTP/HTTPS/NO_PROXY を入力できる Proxy 設定セクションが同一画面に表示される

### Requirement: OpenAI Completions Compatible な Custom Provider 設定
システムは、Custom Provider として OpenAI Completions Compatible 接続先を登録・編集・保存できなければならない（MUST）。また Proxy 設定を同じ保存操作で登録・編集・保存できなければならない（MUST）。

#### Scenario: 必須項目を入力して保存できる
- **WHEN** ユーザーが `name` と `baseUrl` を入力して保存操作を実行する
- **THEN** システムは provider 設定を永続化し、次回起動後も同設定を復元する

#### Scenario: 必須項目不足時は保存を拒否する
- **WHEN** `name` または `baseUrl` が空のまま保存操作を実行する
- **THEN** システムは保存を行わず、不足項目を示すエラーを表示する

#### Scenario: Proxy 設定を保存して次回起動で復元できる
- **WHEN** ユーザーが `httpProxy` または `httpsProxy` を入力して保存操作を実行する
- **THEN** システムは Proxy 設定を永続化し、次回起動後に同値を復元する

#### Scenario: 無効な Proxy URL は保存を拒否する
- **WHEN** ユーザーが URL 形式でない `httpProxy` または `httpsProxy` を入力して保存操作を実行する
- **THEN** システムは保存を行わず、Proxy 設定の入力不備を示すエラーを表示する
