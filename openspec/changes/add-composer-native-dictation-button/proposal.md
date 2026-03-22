## Why

テキスト入力だけでは短い指示や移動中の入力に手間がかかり、チャット送信までの操作負荷が高い。既存 Composer に長押し録音から音声認識まで完結する入力経路を追加し、離した瞬間に確定テキストを textarea へ戻せるようにする。

## What Changes

- Composer の送信ボタン左側にマイクアイコンのボタンを追加する。
- マイクボタンの長押し中はアプリ内で録音状態に入り、波形または録音中 UI を表示する。
- ボタンを離した時点で録音を停止し、macOS は Speech framework で文字起こしして結果を既存 textarea へ反映する。
- 未対応 OS や認識失敗時は、既存のテキスト送信フローを壊さずに失敗を UI から認識できるようにする。

## Capabilities

### New Capabilities

なし

### Modified Capabilities

- `renderer-chat-ui`: Composer でテキスト入力に加えて押下中だけ録音し、離した時点で音声認識結果を反映する操作を提供するよう要求を拡張する

## Impact

- Renderer の Composer UI と入力状態管理
- Renderer の録音制御と波形/録音状態 UI
- Main process の macOS Speech helper bridge と一時ファイル管理
- preload / IPC contract による Renderer-Main 間の音声認識操作追加
- GUI 検証手順と関連テストケース
