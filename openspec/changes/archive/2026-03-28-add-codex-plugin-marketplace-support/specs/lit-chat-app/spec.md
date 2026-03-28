## ADDED Requirements

### Requirement: lilt-settings-modal は plugin 管理タブを提供する
システムは、`<lilt-settings-modal>` に既存の設定タブと並んで `Plugins` タブを提供し、Codex plugin の marketplace 一覧、インストール済み一覧、インストール、削除をモーダル内で管理できなければならない（MUST）。`Plugins` タブはモーダルを閉じずに catalog 読み込み状態、インストール状態、削除状態を反映できなければならない（MUST）。

#### Scenario: Settings メニューに Plugins タブが表示される
- **WHEN** ユーザーが Settings モーダルを開く
- **THEN** モーダルのメニュー項目に `Plugins` が表示される

#### Scenario: Plugins タブ切り替えで plugin 管理 UI が表示される
- **WHEN** ユーザーが `Plugins` タブを選択する
- **THEN** モーダル本体は plugin marketplace または installed plugin の管理 UI を表示し、`Providers & Models`、`Chat`、`Schedules`、`Agent Skills` の内容は表示しない

#### Scenario: plugin インストール後もモーダル内で状態更新できる
- **WHEN** ユーザーが `Plugins` タブで plugin のインストールを完了する
- **THEN** `lilt-settings-modal` はモーダルを閉じずに一覧と状態文言を更新する

#### Scenario: plugin 削除後もモーダル内で状態更新できる
- **WHEN** ユーザーが `Plugins` タブで plugin の削除を完了する
- **THEN** `lilt-settings-modal` はモーダルを閉じずに一覧と状態文言を更新する