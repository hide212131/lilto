## Why

フェーズ 0 と 1 で安全網と削減作業の前提は整ったが、main プロセスには `ipc.ts`、`agent-sdk.ts`、`skill-runtime.ts`、`plugin-service.ts`、`heartbeat-assistant.ts` などの巨大ファイルが残っており、責務の境界が不明瞭なまま変更コストとレビュー難度を押し上げている。フェーズ 2 では挙動を変えずに main プロセスの責務をドメイン単位へ分割し、後続の renderer 分割と横断整理を安全に進められる合成ルートへ整える必要がある。

## What Changes

- `src/main/ipc.ts` をドメイン別モジュールへ分割し、チャネル名と payload 契約は既存の IPC 契約テストで固定したまま維持する。
- `agent-sdk.ts` を、プロセスライフサイクル、イベントストリーム処理、エラー分類・リトライ判定、設定組み立ての責務ごとに分離する。
- `skill-runtime.ts` を、スキル発見、スキル実行、サンドボックスポリシー適用の責務へ分割する。
- `plugin-service.ts` と `heartbeat-assistant.ts` を、依存方向とテスト境界が明確なサービス群へ整理する。
- `src/main/index.ts` を composition root として純化し、起動シーケンスとサービス配線だけを担う構成にする。

## Capabilities

### New Capabilities
- `main-process-modularization`: main プロセスの巨大ファイルをドメイン単位へ分割し、公開契約を維持したまま合成ルートを簡潔に保つための要件を定義する

### Modified Capabilities
- なし

## Impact

- `src/main/ipc.ts`、新設する `src/main/ipc/` 配下、`src/main/ipc-contract.ts`、`src/preload.ts`
- `src/main/agent-sdk.ts` と関連 runtime / error / config モジュール
- `src/main/skill-runtime.ts`、`src/main/plugin-service.ts`、`src/main/heartbeat-assistant.ts`、`src/main/index.ts`
- 既存の安全網である `test/ipc-characterization.test.js`、`test/agent-runtime.test.js`、`test/skill-runtime.test.js`、`test/plugin-service.test.js`、`test/heartbeat-assistant.test.js`
- main プロセスの初期化順序、依存配線、テストで固定されている IPC / runtime 契約