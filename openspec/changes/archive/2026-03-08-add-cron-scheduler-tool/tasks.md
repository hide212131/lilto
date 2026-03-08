## 1. Native scheduler daemon

- [x] 1.1 Rust 製 scheduler daemon プロジェクトを追加し、JSON Lines コマンド (`create` / `list` / `update` / `delete`) を受け付ける最小実装を作る
- [x] 1.2 SQLite 永続化と起動時リハイドレートを実装し、one-shot / recurring schedule を復元できるようにする
- [x] 1.3 発火時に `sessionId` と完了メッセージを含む `fired` イベントを出力し、one-shot は発火後に無効化する

## 2. Main process and agent runtime integration

- [x] 2.1 Electron Main に scheduler daemon supervisor を追加し、起動・ready 待ち・異常終了検知・コマンド送信 API を実装する
- [x] 2.2 Pi の Custom Tool として `cron` ツールを agent runtime に登録し、CRUD 操作を daemon 呼び出しへマップする
- [x] 2.2a `cron` ツールに高水準 operation（`set_timer`, `set_reminder_at`, `set_daily_reminder`）を追加し、頻出ケースでは tool 側が `runAt` / `cronExpr` を正規化する
- [x] 2.2b `cron` ツールに optional な `followUpInstruction` を追加し、発火後に AI が続ける処理を payload として保存できるようにする
- [x] 2.3 scheduler daemon からの `fired` イベントを対象 session のチャット通知へ変換し、非フォーカス時の OS 通知と未読バッジ更新を連携する
- [x] 2.3a scheduler 発火時に `followUpInstruction` があれば、Main がそれを通知イベントへ載せ、Renderer が同一会話で agent runtime の follow-up 実行を開始できるようにする

## 3. Renderer and shared contract updates

- [x] 3.1 scheduler 通知イベントを扱う shared / preload / IPC 契約を追加し、Renderer が対象チャットに通知メッセージを描画できるようにする
- [x] 3.2 チャット UI に scheduler 通知の表示ルールを追加し、通常の AI 応答と区別できる見た目と文言を整える
- [x] 3.3 schedule 登録・更新・削除失敗時のエラーがユーザーに分かるよう、既存の実行エラー表示と整合したメッセージを実装する
- [x] 3.3a scheduler follow-up の loop event と最終応答を既存 UI で表示できるよう、conversation への紐付けを維持したまま中継する

## 4. Packaging and verification

- [x] 4.1 native バイナリを開発・配布ビルドへ組み込む設定を追加し、`process.resourcesPath` / 開発時パスの両方で起動できるようにする
- [x] 4.2 daemon supervisor、tool 呼び出し、通知配送の自動テストを追加する
- [x] 4.2a 高水準 operation の正規化と低水準 API フォールバックの自動テストを追加する
- [x] 4.2b follow-up 指示の保存、発火イベントへの同梱、Main の follow-up 実行開始を自動テストで確認する
- [x] 4.3 GUI 変更として `/live-ui-manual-verification` を実施し、その後 `npm run e2e:electron` で最終 E2E と `test/artifacts/electron-e2e.png` 生成を確認する
- [x] 4.4 OpenSpec artifacts と `tasks/lessons.md` を実装結果に合わせて更新し、仕様と検証結果を同期する
