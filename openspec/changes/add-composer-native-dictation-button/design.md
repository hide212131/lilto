## Context

現在の Composer にはマイクボタンがあるが、実体は `osascript` で OS の dictation UI を叩く方式で、権限・OS 設定・挙動の安定性が低い。今回必要なのは「長押し中だけ録音し、離したら認識結果を textarea に戻す」操作であり、OS の入力 UI を借りるより、アプリ自身が録音と認識完了タイミングを管理できる構成の方が要件に合う。

macOS には `Speech` framework があり、録音済み音声ファイルを認識できる。Electron Renderer では `MediaDevices` / `MediaRecorder` または `WebAudio` で録音し、Main 側は一時 WAV ファイルを Speech helper へ渡して文字起こし結果を受け取る。Windows も将来的には `Windows.Media.SpeechRecognition` へ揃えるが、この変更では macOS を先行実装し、未対応 OS は明示的に unavailable として返す。

## Goals / Non-Goals

**Goals:**

- Composer の送信ボタン左にマイクアイコンの長押しボタンを置く。
- 長押し中はアプリ内で録音状態と録音中 UI を表示する。
- ボタンを離したら録音を止め、macOS Speech helper で文字起こしし、結果を textarea へ追記する。
- 認識失敗や未対応環境でも、既存の手入力と送信フローは維持する。

**Non-Goals:**

- OS 標準 dictation UI を前面表示してその結果を拾うこと
- クラウド文字起こし API へ依存すること
- Windows ネイティブ認識の本実装をこのターンで完了すること
- 録音データの永続保存

## Decisions

### 1. Renderer は長押し中にマイク音声を録音し、離したら音声 Blob を Main へ渡す

Composer は `pointerdown` で録音開始、`pointerup` / `pointercancel` / `blur` で録音停止する。録音そのものは Renderer 側で扱い、PCM/WAV に変換して Main へ渡す。これにより、長押しと録音終了タイミングを UI と一貫して制御できる。

`MediaRecorder` の圧縮フォーマット任せではネイティブ認識側との互換が崩れやすいため、最小実装では単一チャネルの WAV として Main へ渡す。

### 2. Main は `NativeDictationController` ではなく `SpeechTranscriptionService` と macOS helper を使う

Main 側は Renderer から受け取った WAV を一時ファイルへ保存し、macOS では Swift 製 helper を起動して `Speech` framework に渡す。helper は認識テキストまたは失敗理由を JSON で返す。これで Electron から直接 `Speech` framework を叩けない問題を局所化できる。

### 3. macOS helper は録音後ファイル認識に限定し、部分認識ストリームは扱わない

ユーザー要求は「長押し中に録音モードへ入り、離したら文字起こし」なので、まずは録音終了後に一括認識する。押下中の波形表示は録音レベル UI のみとし、部分文字起こしは扱わない。これで helper と IPC を小さく保てる。

### 4. 未対応 OS は明示的に unavailable を返し、UI はフォールバック文言を出す

Windows helper 未実装の間は `UNSUPPORTED_PLATFORM` を返し、UI は「この OS では未対応」と表示する。macOS 優先で品質を固める。

## Risks / Trade-offs

- [Speech framework の権限要求が helper 実行形態に依存する] → helper は単独バイナリとしてビルドし、権限不足時のエラーを UI に返す。
- [Renderer 録音がブラウザ実装差異を受ける] → WAV 変換を自前制御し、E2E は mock 音声データ経路を用意する。
- [長押し解除を取りこぼすと録音が続く] → `pointercancel`、window blur、送信開始前強制停止を同じ停止経路に寄せる。
- [Windows 実装未着手] → 仕様と UI で macOS 先行を明示し、未対応エラーを曖昧にしない。

## Migration Plan

- OpenSpec / docs を「OS dictation UI 起動」から「録音 + Speech helper 認識」へ更新する。
- Renderer に録音開始/停止、レベル表示、textarea 追記ロジックを追加する。
- Main に音声受け取り IPC と macOS Speech helper 実行サービスを追加する。
- macOS 手動確認と mock テストを先に通し、Windows は unavailable 表示で保留する。

## Open Questions

- 開発中 Electron から Speech 権限プロンプトを安定させるために helper を app bundle 化する必要があるか。
- 将来 Windows 実装を C#/WinRT helper として揃えるか、別途クラウド transcription を fallback として持つか。
