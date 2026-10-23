## 現状と設計範囲

2026-10-23 時点の調査。`package.json` は Electron 44.9.3、electron-builder ^26.8.1、アプリ 0.1.4。Windows x64 NSIS は assisted installer（oneClick=false）、perMachine=false、インストール先変更可。appId は `dev.hide.lilto`。署名を明示的に無効化している。公開 origin は `hide212131/lilto`（GitHub API でも PUBLIC と確認）。

`.github/workflows/release.yml` は v* タグで Windows/macOS をビルドし、両方成功後に GitHub Release を公開する。exe/blockmap は転送されるが latest.yml は対象外。`src/main/index.ts` は close を hide に変換し、before-quit で一部サービスを停止する。scheduler-daemon は child process として実行するが終了 API がない。トレイはクリック動作のみで context menu がない。

今回は Windows x64 のみ実装する設計。macOS は署名と notarization の運用、zip と latest-mac.yml の追加が必要なので別 change にする。macOS の既存 DMG 配布を継続し、更新サービス・メニューを有効にしない。

## 採用方式とバージョン

既存 NSIS を維持し `electron-updater` 6.8.11 を本番依存に固定する。npm 公開パッケージの BaseUpdater/NsisUpdater 実装を調査し、`autoDownload=false`、`autoInstallOnAppQuit=false`、`autoRunAppAfterInstall=true`、`allowPrerelease=false`、`allowDowngrade=false` を使用する。builder は現行26系のまま。27系のドキュメントにある autoInstallEvent と混同しない。実装時は lock と型・パッケージ結合検証で整合性を確定する。

Electron 組込み autoUpdater は採用しない。NSIS 対応とハッシュ検証・差分取得を既存ツールに任せる。独自 exe URL 実行や手製バージョン比較は作らない。

## 配信と成果物

builder の `win.publish` に GitHub provider、owner=hide212131、repo=lilto、releaseType=release を明記し、認証不要の公開 stable feed を使う。setFeedURL は呼ばない。トークンをアプリへ同梱せず、ユーザーに GitHub 認証を要求しない。

`--publish never` を維持し、ビルドと公開を分ける。Windows の成果物は exe、blockmap、latest.yml。アプリ内部 resources/app-update.yml が正しい provider を持つことも検証する。latest.yml の version が package/tag と一致し、files が指す exe のサイズと SHA-512 が実ファイルに一致すること、相対ファイル名に traversal がないことを確認する。blockmap と exe の対応も確認し、個別 glob の必須存在を検証する（upload-artifact の if-no-files-found だけでは一部欠落を検出できない）。

公開工程は draft Release 作成 → 全成果物転送 → assets と manifest の対応確認 → 正式公開の順とし、途中失敗時は draft を残す。既存の macOS 成功待ちは維持する。公開済み同一バージョンの exe を差し替えず、問題修正版は必ず番号を上げる。リリース公開操作は実装後の配布工程で行う。

最初の updater 搭載版には既存0.1.4から自動移行できない。ユーザーが一度手動インストールし、その版 A から次版 B の自動更新が可能となる。A/B 検証はこの制約を含める。

## ユーザー操作

1. Main 初期化と renderer の初回 ready が揃ってから、起動ごとに一度だけバックグラウンド確認。起動やチャット利用を通信で待たせない。second-instance や window 再生成では再確認しない。
2. 起動時は新版のみ案内。「Lilt-o {version} を利用できます」、現在版・新版と「更新をダウンロード」「後で」を表示。最新版・通信失敗は割込みを出さずログへ残す。「後で」は当該起動中の自動再提示を止める。次回起動と手動確認では再提示可能。
3. Windows アプリメニュー「ヘルプ > 更新を確認…」とトレイ右クリック「更新を確認…」を同じサービスへ接続。既定の編集・表示・ウィンドウ操作を保持する。トレイの既存クリックも維持。トレイからはウィンドウを復帰・フォーカスして案内する。
4. 手動確認では「確認中」、最新版なら「最新バージョンです ({current})」、失敗なら「更新を確認できませんでした」と「再試行」「閉じる」を表示する。開発実行は通信せず「インストール版で利用できます」。
5. 同意後だけ downloadUpdate()。進捗 percent/bytes を表示し、通常利用を継続できる。ダイアログを閉じても取得は継続し、メニューから状態を再表示する。初期版は明示的な取得取消操作を追加しない。
6. update-downloaded 後に「再起動してインストール」「後で」を提示。ここで再度実行意思を確定する。通常終了・OS終了ではインストールしない。後でを選んだらメニューから再開でき、再起動後は fresh check とライブラリのキャッシュ検証を経て再利用する。
7. 検証済み取得済み版に対してのみ更新用終了を実施し quitAndInstall(false, true) を一度だけ呼ぶ。非 silent の既存インストーラーを見せ、autoRunAppAfterInstall=true で終了後の起動を要求する。インストーラーの完了・再起動選択を含む実際の挙動は A→B 実機検証の必須条件とする。ユーザーがキャンセルすれば旧版の手動起動を案内し、自動成功とは扱わない。

## サービスと状態の契約

`src/main/app-update-service.ts` を新設。updater adapter と runtime lifecycle を注入し、Main が状態の正本を持つ。状態は unsupported / idle / checking / available / downloading / downloaded / preparing-install / installing / error。snapshot は currentVersion、targetVersion?、progress?、固定文言のmessage?、source?、revision。manifest URL、ローカル exe パス、生のエラー、任意コマンドを renderer に渡さない。

check(source: startup|manual)、download()、install()、getSnapshot() を公開。check は single-flight で手動呼出しを既存要求へ合流し、結果を手動要求として表示する。downloading/downloaded/preparing-install/installing 中は既存状態を表示し、新規チェックを始めない。download/install の連打を防ぎ、誤った状態からの操作は拒否する。updater の error イベントと Promise rejection を捕捉し、同じ失敗文言を重複表示しない。snapshot revision で受信順を判定する。通信ごとの時間制限は electron-updater の HTTP 実装に任せ、独自 timeout は設けない。

preload は `getAppUpdateState` / `checkAppUpdate` / `downloadAppUpdate` / `installAppUpdate` / `onAppUpdateState` の固定 API と unsubscribe を提供する。renderer ready 時に購読して snapshot を取得し、revision で順序を整える。起動時通知は snapshot の source で復元し取りこぼさない。メニュー操作は IPC を迂回して同サービスを呼ぶ。

`src/shared/app-update.ts` に契約、renderer に更新ダイアログを新設。キーボード、Escape、フォーカス復帰、進捗読み上げを提供する。release notes の HTML は描画しない。既存 IPC 分割方針に従い専用 registrar を置き、巨大ファイルへ処理を追加しない。

## 終了・実行中処理・データ保護

更新選択だけでチャットを切らない。install の準備で新規対話・scheduler 実行・音声・スキル導入等の子プロセスを伴う操作の受付を止め、Main の実行中処理を再判定する。実行中なら準備を解除し「処理完了後に更新してください」で downloaded に戻す。自動で後刻終了させない。入力途中なら renderer が「入力内容は再起動で失われます。続行しますか？」を提示し、取消時は終了しない。settings 保存中も完了を待つ。既存の永続化済み会話、設定、skills、scheduler.db、Codex home を削除・移動しない。

Main runtime から prepareForUpdate()/resumeAfterFailedPreparation()/disposeForUpdate() を明示的に返す設計とする。scheduler に stop/dispose を追加し stdin close → exit 待ち → 最大5秒でアプリ所有 child のみ終了、Codex app-server、音声等も所有ハンドルで終了する。全体10秒以内に停止確認が取れなければ install を実行せず、受付を復旧してエラー表示する。名前指定の全プロセス kill はしない。実装時は runtime が生成する全 child と書込処理を棚卸しし、終了試験で漏れを検出する。

停止完了後に isQuitting=true を設定して close→hide を迂回し quitAndInstall を呼ぶ。before-quit は冪等の通常後片付けを維持し、非同期停止を before-quit 内で初めて始めない。インストーラー起動失敗でプロセスが残る場合は isQuitting を戻し、停止済みサービスを再作成して通常利用へ戻す。復旧不能なら再起動案内を表示する。spawn 後の失敗は旧プロセスから完全には追跡できないため成功ログを先取りしない。再起動時の実 version とデータ保持で成功を判定する。

## 失敗と信頼境界

オフライン、404、rate limit、容量不足、ハッシュ不一致は現行アプリを維持し手動再試行を提供。検証失敗した exe は実行しない。差分取得が失敗した場合の全量取得はライブラリの標準機能を使う。キャッシュはライブラリへ委譲し、アプリ独自の無検証再利用をしない。

初期版は現行の未署名配布を引き継ぐ。6.8.11 は publisherName がない場合 Authenticode 検証をスキップするため、署名による発行者確認を保証しない。HTTPS の公開 feed と SHA-512 で転送整合性を確認するが、公開アカウント侵害には対応できない。署名検証を強制成功させる callback は実装しない。将来署名導入時は publisherName と CI 署名設定を追加する。SmartScreen/UAC が表示され得るので無操作更新を約束せず、OS 警告を迂回しない。

## 実装箇所

| 対象 | 変更 |
|---|---|
| package.json / package-lock.json | electron-updater 固定、win.publish、nsis.runAfterFinish=true 明記 |
| src/main/index.ts / main-runtime.ts | 一回の起動確認、サービス構築、更新用終了と復旧 |
| src/main/notifications.ts / 新規 app-menu.ts | トレイとアプリメニューの導線 |
| src/main/app-update-service.ts / ipc/app-update.ts | 状態機械と固定 IPC |
| src/main/scheduler.ts / 所有 child 各サービス | 有限時間の停止・終了確認 |
| src/shared/app-update.ts / preload / renderer | 型、状態通知、ダイアログ、未送信入力確認 |
| .github/workflows/release.yml / scripts/verify-dist-artifacts.js | metadata 必須検証、draft 経由の公開 |
| test / scripts | サービス単体、GUI 回帰、Windows インストール更新試験 |

## 検証・リリース条件

サービスの fake adapter でイベント順序・連打・タイムアウト・失敗・終了阻害を振る舞いテスト。GUI は最初に `/live-ui-manual-verification` で実画面確認。主要操作は Playwright、Electron 固有の難所のみ WebdriverIO Electron Service で補う。全 GUI 変更後の最後に `npm run e2e:electron` の成功と test/artifacts/electron-e2e.png を確認する。E2E_MOCK は取得・インストールを fake に固定し実インストーラーを起動しない。

別途 Windows VM で同一 appId・同一配布設定の版 A/B を実際にインストールし、専用の認証不要テスト feed をテストビルド時だけ指定して更新する。本番へのテスト版公開は禁止。A の起動→案内→取得→終了→NSIS→B 自動起動→version と設定/会話/DB/skills保持、既定/カスタムパス、常駐状態、起動中プロセス、installer cancel、オフライン・不正ハッシュを確認。ビルド生成やGUI mock成功だけを自動更新完了としない。

実装を開始し、更新サービス・IPC・案内画面・NSIS終了準備と公開前検査を追加した。単体契約とmacOS実画面の検証は通過した。Windows package/manifest の実生成、GitHub draft公開と実インストーラーによる A→B 更新検証が残る。今回のゴールは公開リリースまでであり、Windowsの実更新検証が完了するまで正式公開しない。

## 参照

- [electron-builder v26 自動更新](https://www.electron.build/v26/docs/features/auto-update/): NSIS、metadata、macOS 署名と zip。
- [electron-builder v26 NSIS](https://www.electron.build/v26/docs/nsis/): assisted installer と runAfterFinish。
- [electron-updater 6.8.11 公開パッケージ](https://registry.npmjs.org/electron-updater/-/electron-updater-6.8.11.tgz): BaseUpdater.js / NsisUpdater.js の終了・再起動・署名分岐を直接確認。
