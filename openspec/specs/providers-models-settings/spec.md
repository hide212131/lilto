# providers-models-settings Specification

## Purpose
TBD - created by archiving change add-providers-and-models-custom-provider. Update Purpose after archive.
## Requirements
### Requirement: Providers & Models 設定画面の提供
システムは、Settings モーダル内の設定メニューを `Providers & Models` として提供し、Codex のブラウザ OAuth と API key 設定導線を同一画面で提示しなければならない（MUST）。また同一画面でネットワーク Proxy 設定導線を提示しなければならない（MUST）。設定画面は Pi 由来の複数 OAuth provider 選択 UI を表示してはならない（MUST NOT）。Windows 上では、同一画面に Codex Windows sandbox モード設定と状態表示を提示しなければならない（MUST）。

#### Scenario: 設定メニューが Providers & Models を表示する
- **WHEN** ユーザーが Settings モーダルを開く
- **THEN** メニュー項目は `Providers & Models` を表示する

#### Scenario: Codex 認証セクションが表示される
- **WHEN** ユーザーが `Providers & Models` を選択する
- **THEN** Codex 認証状態、認証方式の選択、ブラウザ OAuth の認証開始アクション、API key 入力欄を含むセクションが表示される

#### Scenario: Proxy 設定セクションが表示される
- **WHEN** ユーザーが `Providers & Models` を選択する
- **THEN** `useProxy` を切り替えできる Proxy 設定セクションが同一画面に表示される

#### Scenario: Windows では sandbox 設定セクションが表示される
- **WHEN** Windows 上のユーザーが `Providers & Models` を開く
- **THEN** `off` / `unelevated` / `elevated` を選べる Windows sandbox 設定セクションが表示される

#### Scenario: Pi provider 選択 UI は表示されない
- **WHEN** ユーザーが `Providers & Models` を開く
- **THEN** `anthropic` / `github-copilot` / `google-gemini-cli` などを選ぶ OAuth Provider の選択 UI は表示されない

### Requirement: Provider 別の実行可否表示
システムは、選択中の Codex 認証方式の準備状態に応じて、送信可否と不足条件を UI へ表示しなければならない（MUST）。認証状態の評価は選択中の認証方式に基づかなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、setup 未完了・失敗・利用可能の状態も同じ画面で判別できなければならない（MUST）。

#### Scenario: 未認証時に不足条件を表示する
- **WHEN** 認証方式がブラウザ OAuth で、Codex 認証が未完了の状態である
- **THEN** UI は送信を無効化し、Codex 認証が必要である旨を表示する

#### Scenario: API key 未設定時に不足条件を表示する
- **WHEN** 認証方式が API key で、有効な Codex API key が未設定である
- **THEN** UI は送信を無効化し、API key の入力が必要である旨を表示する

#### Scenario: 選択中方式の準備完了で送信可能になる
- **WHEN** 選択中の認証方式に必要な条件が満たされている
- **THEN** UI は送信を有効化し、追加の provider 選択を要求しない

#### Scenario: Windows sandbox setup 未完了が表示される
- **WHEN** Windows sandbox モードを有効化したが setup が未完了または失敗している
- **THEN** UI はその状態を表示し、再試行または `off` への変更を促す
