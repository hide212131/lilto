## Why

lilto は現在 Codex skill の導入と管理には対応している一方、Codex plugin の marketplace 探索、インストール、利用開始の導線を持っていません。Codex TypeScript SDK には plugin 管理 API がまだ見当たりませんが、Codex 本体の app-server には `plugin/list` / `plugin/read` / `plugin/install` / `plugin/uninstall` RPC があるため、現時点ではその RPC を adapter の裏で利用しつつ、将来 SDK 側に正式 API が追加されたときに差し替え可能な境界を先に作る必要があります。

## What Changes

- Codex plugin を lilto から探索・インストール・一覧表示・削除できる Main/Renderer の管理経路を追加する。
- OpenAI curated marketplace と、アプリのルート相対 `.agents/plugins/marketplace.json` を source catalog として扱えるようにする。
- インストール済み plugin を lilto が管理する Codex 実行環境の install store / cache へ配置し、通常の Codex runtime から次回送信または新規 thread で利用可能にする。
- plugin の marketplace 解決と install/uninstall/list 操作を app-server RPC adapter の裏へ閉じ込め、将来の Codex SDK plugin API へ移行しやすい構造にする。
- **BREAKING** Settings モーダルの管理タブ構成を拡張し、`Agent Skills` と並んで `Plugins` タブを追加する。

## Capabilities

### New Capabilities
- `codex-plugin-marketplace-management`: Codex plugin の marketplace 取得、一覧、インストール、削除、install metadata 管理を扱う。

### Modified Capabilities
- `pi-main-agent-runtime`: lilto が管理した plugin marketplace と install state を Codex runtime 起動環境へ反映し、インストール済み plugin を利用可能にする要件を追加する。
- `lit-chat-app`: Settings モーダルに `Plugins` タブを追加し、plugin 管理 UI を提供する要件へ更新する。

## Impact

- 影響コード: `src/main/skill-runtime.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/components/settings-modal.ts`, `src/renderer/types.ts`, `src/main/agent-sdk.ts`, テスト一式。
- 新規コード候補: plugin service / app-server RPC adapter / marketplace source resolver / plugin state mapper。
- 外部依存: OpenAI curated marketplace の同期元として `openai/plugins` リポジトリまたはその `marketplace.json` を参照する。
- 保存領域: lilto が管理する `HOME` / `CODEX_HOME` 配下に plugin store と runtime-visible marketplace を追加する。