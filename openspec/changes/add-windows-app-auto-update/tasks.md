## 1. 依存と配布設定

- [x] 1.1 electron-updater 6.8.11 を本番依存と lock に追加し、現行 builder26との型・packaging 互換性を確認する。
- [x] 1.2 win.publish の公開 GitHub stable feed と nsis.runAfterFinish を設定し、開発/macOSガードを定義する。
- [ ] 1.3 verify-dist に exe/blockmap/latest.yml/app-update.yml と version/サイズ/hash/参照の必須検証を追加する。
- [ ] 1.4 release workflow で latest.yml を転送し、draft登録・全assets検証・正式公開の順にする。欠落時失敗のテストを追加する。

## 2. 更新サービスと契約

- [x] 2.1 shared型と updater adapter を定義し、状態機械・single-flight・世代・timeout・失敗復帰を実装する。
- [x] 2.2 同意による download と進捗、再取得・キャッシュ検証、通常終了時インストール無効を接続する。
- [x] 2.3 固定 IPC と preload API、送信元検証、snapshot/購読・unsubscribe を追加する。
- [ ] 2.4 fake adapter で連打、起動/手動競合、失敗二重通知、古い応答、timeout、hash失敗を単体検証する。

## 3. 更新用終了

- [ ] 3.1 runtime の全childと書込処理を棚卸しし、実行中判定・新規受付停止と復旧を追加する。
- [ ] 3.2 scheduler/Codex/音声など所有childの有限時間停止と終了確認を実装し、準備timeoutを検証する。
- [ ] 3.3 isQuitting と冪等cleanup、quitAndInstall(false,true)、起動失敗時のサービス再構築を接続する。
- [ ] 3.4 実行中処理の拒否、準備失敗、通常終了で更新しないこと、installer呼出し一回を単体検証する。

## 4. メニューと案内

- [x] 4.1 アプリ/トレイに更新確認を追加し、既存メニューとクリック操作を保持する。
- [x] 4.2 初回renderer ready後に一度確認し、新版のみ自動案内、手動全結果、後でと再表示を接続する。
- [x] 4.3 更新ダイアログに進捗・再試行・再起動、未送信入力の喪失確認、キーボードと読み上げを追加する。
- [ ] 4.4 live-ui-manual-verification で画面・トレイ復帰・フォーカス・失敗・実行中と入力保護を確認する。

## 5. 実更新と最終確認

- [ ] 5.1 Windows VM と専用テストfeedで updater 搭載A/Bを用意し、既定/カスタムパスで案内→NSIS→B自動起動とデータ保持を検証する。
- [ ] 5.2 実機で常駐・child終了、installer取消、オフライン、不正hashを確認しログと版番号の証跡を残す。
- [ ] 5.3 初回のみ手動導入、未署名の制約、公開失敗/不具合時は新番号で修正する運用を配布手順へ記す。
- [ ] 5.4 型・単体・成果物検証を完了し、全GUI変更後の最終確認として npm run e2e:electron を成功させ test/artifacts/electron-e2e.png の生成を確認する。主要操作はPlaywright、Electron固有難所のみWebdriverIO Electron Serviceを使用する。

本依頼は実装直前までの設計。すべて実装再開後の作業として未着手で残す。各項目は概ね2時間以内、5.1は環境準備と各パス試験を必要に応じ分割する。
