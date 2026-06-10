## Why

大規模なリファクタリング計画を安全に進める前に、現状の挙動を素早く検証できる基盤が不足している。現状は `npm test` ごとにフルビルドが走り、CI でも型チェックや単体テストの回帰を自動で止められないため、以降のフェーズでデグレを見逃すリスクが高い。

## What Changes

- renderer バンドルを経由しない高速な `test:unit` 実行経路を追加し、TypeScript の incremental build を有効化する。
- macOS と Windows の両方で型チェックと unit テストを実行する CI ワークフローを追加する。
- 未使用 export / 依存関係 / ファイル数 / 行数のベースライン計測結果を保存し、後続フェーズの削減効果を比較可能にする。
- main IPC のチャネル名と引数・戻り値の形を固定する特性テストを追加し、後続の分割リファクタリングに対する安全網を整える。

## Capabilities

### New Capabilities
- `refactoring-safety-net`: リファクタリング開始前に必要な高速テスト経路、CI ゲート、ベースライン計測、IPC 契約の特性テストを定義する。

### Modified Capabilities

- なし

## Impact

- `package.json`、TypeScript 設定、テスト実行スクリプト
- `.github/workflows/` の CI 定義
- `tasks/` 配下のベースライン記録
- `test/` の IPC 契約テスト
- `src/main/ipc.ts` と関連する IPC 契約定義