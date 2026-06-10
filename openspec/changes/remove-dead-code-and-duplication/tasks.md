## 1. 未使用候補の棚卸しと削除

- [x] 1.1 `tasks/refactoring-baseline.md` の knip / depcheck 結果を見直し、削除候補ごとに grep で実参照の有無を確認する
- [x] 1.2 未使用 export と未使用ファイルを小分けで削除し、動的参照の疑いがある候補は除外または保留理由を記録する
- [x] 1.3 未使用 npm 依存を `package.json` から削除し、`package-lock.json` を更新する

## 2. パス解決モジュールの統合

- [x] 2.1 `user-data-path.ts` の責務を `app-paths.ts` へ移し、user data path の決定点を 1 モジュールへ統合する
- [x] 2.2 `index.ts` を含む呼び出し元の import と利用箇所を更新し、旧モジュールを削除する
- [x] 2.3 パス解決の既存挙動を確認できるテストまたは既存検証を実行し、契約を壊していないことを確認する

## 3. スキル定義の単一ソース化

- [x] 3.1 `.claude/skills/` を正本とする方針で同期スクリプトを整理し、`.codex/skills/` と `.github/skills/` を再生成対象にする
- [x] 3.2 build / prebuild フローにスキル同期を組み込み、手動コピー前提の運用を除去する
- [x] 3.3 README などの関連文書に、正本と生成物の扱い、および更新手順を明記する

## 4. 検証と完了条件の確認

- [x] 4.1 `npm test` を実行し、削除と統合の変更が既存テストを壊していないことを確認する
- [x] 4.2 `npm run dist:mac` 相当の packaged build 検証を実行し、asarUnpack や extraResources の参照が壊れていないことを確認する
- [x] 4.3 削除した候補、保留した候補、同期スクリプト化した対象を change 内で見直し、フェーズ 2 へ渡せる状態に整理する