## 1. 録音と音声認識ブリッジ

- [x] 1.1 preload と IPC contract を、録音済み音声の文字起こし API に更新する
- [x] 1.2 Main process に `SpeechTranscriptionService` を追加し、一時 WAV ファイル管理を実装する
- [x] 1.3 macOS 向け Swift helper を追加し、Speech framework で音声ファイルを文字起こしできるようにする
- [x] 1.4 Windows は未対応エラーを返す暫定実装へ整理する

## 2. Composer UI と状態管理

- [x] 2.1 Composer の送信ボタン左にマイクアイコンボタンと録音中 UI を追加する
- [x] 2.2 長押し開始・解除・キャンセル・blur に応じて録音開始/停止と文字起こし要求を行う状態管理を実装する
- [x] 2.3 認識結果を textarea へ追記し、未対応/失敗時でも手入力へ戻れるステータス表示を追加する

## 3. 検証

- [x] 3.1 Renderer-Main 境界のテストを追加し、長押し中だけ録音/文字起こし要求が発行されることを確認する
- [ ] 3.2 `/live-ui-manual-verification` で macOS 手動確認手順を更新し、長押し録音→離して文字起こしを確認する
- [ ] 3.3 GUI 変更の最終確認として `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する
