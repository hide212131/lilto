## Why

現在の cron scheduler は AI 経由で登録・一覧・削除できますが、ユーザーが後から設定画面で登録済みスケジュールを確認したり、不要になった予定を直接削除したりする導線がありません。通知が増えたあとに UI から安全に棚卸しできないため、誤登録や古い定期予定を残したまま使い続けやすく、運用負荷が高くなっています。

## What Changes

- Settings モーダルに cron スケジュール管理用の表示導線を追加し、登録済みスケジュールを一覧できるようにする。
- 各スケジュールについて、種別、タイトル、次回実行時刻または実行条件、通知先会話との関係が分かる形で表示する。
- Settings UI から不要なスケジュールを削除できるようにし、削除結果を即座に一覧へ反映する。
- Renderer から scheduler の一覧取得・削除を呼べる IPC/preload 境界を追加する。

## Capabilities

### New Capabilities
- `scheduler-settings-management`: Settings 画面から登録済みスケジュールを一覧し、不要なスケジュールを削除できる。

### Modified Capabilities
- `lit-chat-app`: `lilt-settings-modal` が cron スケジュール管理タブまたは同等の UI 導線を持ち、一覧取得と削除操作の結果を反映する。

## Impact

- Affected code: `src/renderer/components/settings-modal.ts`, `src/renderer/app.ts`, `src/renderer/types.ts`, `src/preload.ts`, `src/main/index.ts` 周辺の IPC 登録。
- Affected systems: Electron preload/Main IPC、既存 `SchedulerService` の一覧・削除 API 利用、Settings UI のタブ構成。
- Tests: Settings UI 契約テスト、scheduler 関連 IPC テスト、必要に応じて Renderer コンポーネントテストの更新が必要。