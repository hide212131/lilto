## 1. 高速テスト経路の整備

- [x] 1.1 `package.json` と TypeScript build 設定を更新し、renderer バンドルを経由しない `test:unit` スクリプトを追加する
- [x] 1.2 main 向け TypeScript build に incremental を有効化し、既存の `npm test` フローと衝突しないことを確認する
- [x] 1.3 `test:unit` の対象と責務を README または関連ドキュメントに明記し、フル検証との使い分けを固定する

## 2. CI ゲートの追加

- [x] 2.1 `.github/workflows/` に macOS / Windows の型チェックジョブを追加し、`tsc --noEmit` を実行する
- [x] 2.2 同じ workflow に `npm run test:unit` を追加し、既存のネイティブ build workflow と独立して失敗を報告できるようにする
- [x] 2.3 CI で必要なキャッシュや前提セットアップを整理し、ローカルと CI の実行差分を最小化する

## 3. ベースライン計測と IPC 安全網

- [x] 3.1 `knip` と補助コマンドで未使用 export / 依存関係 / ファイル数 / 行数のベースラインを取得し、`tasks/refactoring-baseline.md` に保存する
- [x] 3.2 `src/main/ipc.ts` の公開チャネルを対象に、チャネル名と payload 形状を固定する特性テストを追加する
- [x] 3.3 特性テストが既存の `*-ui-contract.test.js` と同じ流儀で回るように調整し、後続の分割リファクタリングで再利用可能にする

## 4. 検証

- [x] 4.1 `npm run test:unit` を実行し、高速経路が renderer ビルドなしで通ることを確認する
- [x] 4.2 フルの `npm test` を実行し、既存の総合検証フローを壊していないことを確認する
- [x] 4.3 追加した CI workflow、ベースライン文書、IPC 特性テストを含めて change を見直し、フェーズ 1 以降へ渡せる安全網が揃っていることを確認する