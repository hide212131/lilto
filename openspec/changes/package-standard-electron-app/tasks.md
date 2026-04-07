## 1. Packaging 基盤の追加

- [x] 1.1 `electron-builder` など配布に必要な dependency と script を追加し、`npm run dist` で前提 build から packaging まで完結するようにする
- [x] 1.2 `package.json` または専用設定ファイルに app metadata、出力先、`files`、`extraResources`、macOS/Windows 向け target を定義する
- [x] 1.3 配布に必要な icon / release metadata / ignore 対象を整理し、既存の開発起動フローを壊さないようにする

## 2. 配布後の runtime 整合

- [x] 2.1 `scheduler-daemon` と `speech-transcriber` の helper path 解決を共通方針へ寄せ、development / packaged の両方で解決できるようにする
- [x] 2.2 packaged resources 前提の path 解決や同梱漏れを検知できるテストを追加・更新する
- [x] 2.3 README または配布手順ドキュメントに、配布コマンドと生成物の確認方法を追記する

## 3. 検証

- [x] 3.1 `npm run build` と追加した test を実行し、既存フローが回帰していないことを確認する
- [x] 3.2 `npm run dist` を実行し、`release/` 配下に macOS / Windows 向け想定成果物が生成されることを確認する
- [x] 3.3 配布成果物へ native helper が同梱されていることを確認し、結果を OpenSpec artifacts と `tasks/lessons.md` に反映する
