## 1. Release基盤の整備

- [x] 1.1 既存の `build` / `start` 導線を壊さないように、release 用の script 群（prepare/package/publish）と必要な依存設定を `package.json` と関連スクリプトへ追加する
- [x] 1.2 release metadata / manifest を生成する仕組みを実装し、配布対象 artifact・version・release notes・verification 状態を一元管理できるようにする
- [x] 1.3 配布ビルドでも native binary と必要リソースが同梱されるように Electron packaging 設定を整理する

## 2. OS別パッケージング

- [x] 2.1 macOS で配布用 package を生成するコマンドと出力構成を実装し、ローカルで再現できるようにする
- [x] 2.2 Windows 向け package の前段準備を macOS で実行できるようにし、Windows runner / 実機で同じ metadata から続行できるようにする
- [x] 2.3 Windows 側で package 成功・起動確認・未完了項目を段階管理できる verification 記録を実装または文書化する

## 3. GitHub/GitLab公開自動化

- [x] 3.1 GitHub Releases と GitLab Releases の双方へ同一 artifact セットを publish する共通処理を実装する
- [x] 3.2 公開先ごとの認証情報、draft/release-candidate 運用、失敗時の再試行単位をスクリプトまたは workflow に落とし込む
- [x] 3.3 片系統 publish 失敗時に原因を切り分けられるログと運用メモを整備する

## 4. 検証と運用手順

- [x] 4.1 macOS で release prepare/package が成功することを確認し、成果物の配置と manifest 内容を検証する
- [x] 4.2 GitHub / GitLab 向け publish を dry-run または draft 作成相当で確認し、同一 version / artifact が扱われることを検証する
- [x] 4.3 Windows 環境で branch を引き継ぎ、package と起動確認を進めるための手順書・チェックリストを更新する
- [x] 4.4 実装結果に合わせて OpenSpec artifacts と `tasks/lessons.md` を更新し、仕様・設計・検証条件の整合を取る
