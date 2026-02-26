# providers-models-settings Specification

## Purpose
TBD - created by archiving change add-providers-and-models-custom-provider. Update Purpose after archive.
## Requirements
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
- **THEN** `useProxy` を切り替えできる Proxy 設定セクションが同一画面に表示される

### Requirement: OpenAI Completions Compatible な Custom Provider 設定
システムは、Custom Provider として OpenAI Completions Compatible 接続先を登録・編集・保存できなければならない（MUST）。また Proxy 設定を同じ保存操作で登録・編集・保存できなければならない（MUST）。

#### Scenario: 必須項目を入力して保存できる
- **WHEN** ユーザーが `name` と `baseUrl` を入力して保存操作を実行する
- **THEN** システムは provider 設定を永続化し、次回起動後も同設定を復元する

#### Scenario: 必須項目不足時は保存を拒否する
- **WHEN** `name` または `baseUrl` が空のまま保存操作を実行する
- **THEN** システムは保存を行わず、不足項目を示すエラーを表示する

#### Scenario: Proxy 設定を保存して次回起動で復元できる
- **WHEN** ユーザーが `useProxy` のオン/オフを変更して保存操作を実行する
- **THEN** システムは Proxy 設定を永続化し、次回起動後に同値を復元する

#### Scenario: Proxy 設定未指定時は環境既定値を採用する
- **WHEN** `networkProxy.useProxy` が保存データで指定されていない状態で設定を正規化する
- **THEN** システムは `HTTP_PROXY` / `HTTPS_PROXY` 系環境変数の有無を既定値として `useProxy` に反映する

### Requirement: Provider 別の実行可否表示
システムは、現在選択されている provider の準備状態に応じて、送信可否と不足条件を UI へ表示しなければならない（MUST）。

#### Scenario: Claude 未認証時に不足条件を表示する
- **WHEN** 現在 provider が Claude で OAuth 未完了の状態である
- **THEN** UI は送信を無効化し、Claude 認証が必要である旨を表示する

#### Scenario: Custom Provider 未設定時に不足条件を表示する
- **WHEN** 現在 provider が Custom Provider で必須設定が未完了である
- **THEN** UI は送信を無効化し、不足している設定項目を表示する

