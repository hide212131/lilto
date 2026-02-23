## Why

現在の実装は Main 側の Pi SDK 連携と最小 UI に重点があり、継続利用しやすいチャット体験と Renderer/Main の責務を踏まえた UI 方針が十分に具体化されていない。今後の機能追加で UI の一貫性と移植判断を維持するため、チャット UI 実装とポーティング方針の明文化を同時に進める必要がある。

## What Changes

- Renderer に、ユーザー入力と応答表示を会話単位で扱えるチャット UI（入力欄、送信、メッセージ表示、送信中/失敗状態）を追加する。
- UI 実装を `pi-web-ui` / `pi-web-ui-example` の構成に寄せるため、Renderer で扱う責務と Main に移す責務の境界を定義し、ドキュメント化する。
- Electron Renderer で直接利用できない依存（ファイル I/O 等）を伴う機能は Main 側へポーティングする方針を、対象・非対象とともに明示する。
- `docs/` 配下の UI 方針文書を、実装時に参照できる具体度（流用ポイント、変更ポイント、禁止事項）まで更新する。

## Capabilities

### New Capabilities
- `renderer-chat-ui`: Renderer 上でユーザー要求と応答テキストを会話形式で送受信・表示する UI の要件を定義する。
- `renderer-ui-porting-guidelines`: `pi-web-ui` 系構成を Electron へ適用する際の責務分離、流用範囲、Main 側ポーティング基準を定義する。

### Modified Capabilities
- `desktop-shell`: Renderer/Main の責務分離要件を、UI ポーティング方針に基づく具体的な境界ルールまで拡張する。

## Impact

- Affected code:
  - `src/renderer.*`（または同等の Renderer UI 実装）
  - `src/main.*` の IPC 連携面（UI 追加に伴う要求/応答の橋渡し）
  - `docs/ui-porting-guidelines.md`（UI 方針の具体化）
- Affected systems:
  - Electron Renderer/Main 境界
  - Pi SDK を呼び出す Main 実行系
- Dependencies:
  - `pi-web-ui` / `pi-web-ui-example` の構成参照
  - 既存 `agent-bridge` / `pi-main-agent-runtime` との整合
