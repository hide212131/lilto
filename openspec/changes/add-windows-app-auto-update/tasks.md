## 1. 依存と配布設定

- [x] 1.1 electron-updater 6.8.11 を本番依存と lock に追加し、現行 builder との型・package 互換性を確認する。
- [x] 1.2 Windows stable GitHub feed、NSIS installer の自動再起動、開発環境とmacOSの updater ガードを設定する。
- [x] 1.3 Windows exe、blockmap、latest.yml、app-update.yml を package version、サイズ、hash、参照先とともに検証する。
- [x] 1.4 Release workflow で両OSの成果物を集め、整合性検査後にGitHub Releaseを公開する。v0.1.5で一連の検証に成功した。

## 2. 更新サービスと契約

- [x] 2.1 共有型と updater service、状態遷移、起動/手動checkのsingle-flight、失敗時の再試行を実装する。
- [x] 2.2 利用者の同意後にdownloadし、進捗を表示する。通常終了ではinstallerを自動実行しない。
- [x] 2.3 固定IPC channel、sender検証、preload API、状態snapshotと購読解除を追加する。
- [x] 2.4 fake updater test で起動/手動checkの競合、同意前にdownloadしないこと、進捗、installerの一回実行を確認する。
- [ ] 2.5 重複error通知、古い応答、timeout、download/hash失敗の状態遷移を追加検証する。

## 3. 更新用終了

- [x] 3.1 AgentRuntime、scheduler、音声処理の実行中状態を更新前に確認し、scheduler の新規command受付を停止する。
- [x] 3.2 scheduler child を有限時間で停止し、停止失敗を返す。更新準備に失敗した場合はschedulerを再開する。
- [x] 3.3 通常のquit時に更新installerを起動しない。更新経路では isQuitting を立て、quitAndInstall(false, true) を一度呼び出す。
- [ ] 3.4 全runtime child・書込処理の棚卸しと、アプリ全体で新規処理を原子的に止めて復旧する仕組みを追加する。
- [ ] 3.5 更新準備失敗、通常quit、native installer起動失敗と復旧をWindows実機で検証する。

## 4. メニューと案内

- [x] 4.1 アプリとtrayに手動更新確認を追加し、既存メニュー操作を保持する。
- [x] 4.2 初回renderer ready後に自動checkし、新版のみ起動時に案内する。手動check、後で、再表示を接続する。
- [x] 4.3 進捗、再試行、再起動、未送信入力の確認、キーボード操作と読み上げを追加する。
- [x] 4.4 手動UI確認とElectron E2Eで更新dialog、focus、Escape、入力保護を確認する。
- [ ] 4.5 tray復帰、失敗表示とretry、処理中の更新拒否をWindows実機で確認する。

## 5. 実更新と最終確認

- [ ] 5.1 Windows実機の v0.1.5 → v0.1.6 A/B更新を、既定/カスタムinstall path、再起動、データ保持まで確認する。
- [ ] 5.2 実機でinstaller取消、offline、不正hash、常駐childの終了を確認し、ログと版番号を記録する。
- [x] 5.3 v0.1.5のRelease notesに初回手動導入、macOSは手動更新、未署名installerの注意を記載する。
- [x] 5.4 208件のunit tests、macOS/Windows package検証、Electron E2Eと screenshot 生成を確認する。

v0.1.5 はWindows自動更新を含む初回リリース。v0.1.4以前は一度手動でv0.1.5を導入する必要があり、macOS自動更新は未対応。Windows実機のA/B更新と異常系確認は未実施で、上記の未完了項目として追跡する。
