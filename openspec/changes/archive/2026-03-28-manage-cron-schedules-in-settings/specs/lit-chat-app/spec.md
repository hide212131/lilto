## ADDED Requirements

### Requirement: lilt-settings-modal は schedule 管理タブを提供する
システムは、`<lilt-settings-modal>` に既存の設定タブと並んで `Schedules` タブを提供し、schedule 管理 UI へ遷移できなければならない（MUST）。`Schedules` タブはモーダルを閉じずに一覧取得状態と削除状態を反映できなければならない（MUST）。

#### Scenario: Settings メニューに Schedules タブが表示される
- **WHEN** ユーザーが Settings モーダルを開く
- **THEN** モーダルのメニュー項目に `Schedules` が表示される

#### Scenario: Schedules タブ切り替えで schedule 管理 UI が表示される
- **WHEN** ユーザーが `Schedules` タブを選択する
- **THEN** モーダル本体は schedule 一覧またはその取得状態を表示し、`Providers & Models` や `Agent Skills` の内容は表示しない

#### Scenario: schedule 削除後もモーダル内で状態更新できる
- **WHEN** ユーザーが `Schedules` タブで削除操作を完了する
- **THEN** `lilt-settings-modal` はモーダルを閉じずに一覧と状態文言を更新する