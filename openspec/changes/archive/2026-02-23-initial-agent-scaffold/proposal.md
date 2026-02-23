## Why

Lilt-o の方向性は README に定義されているが、Electron と Pi を組み合わせた最小実装の仕様境界が未定義で、着手単位が不明確になっている。まず最小の常駐エージェント基盤を仕様化し、以降の実装・検証・拡張を段階的に進められる状態を作る必要がある。

## What Changes

- Electron アプリとして常駐可能な最小構成（Main/Renderer 分離、起動経路）を定義する。
- Main プロセスで `pi-coding-agent` の SDK を利用し、テキスト要求を受け取ってエージェント処理を実行する経路を定義する。
- Renderer プロセスに最小 UI（入力と応答表示）を定義し、Main のエージェント機能と連携させる。
- ハートビートによる定期実行の最小機能（固定間隔での登録タスク実行）を定義する。
- 音声入力・ウェイクワードは本変更では扱わず、将来拡張として境界を明確化する。

## Capabilities

### New Capabilities
- `desktop-shell`: Electron ベースの常駐アプリとして、Main/Renderer の責務分離と起動ライフサイクルを扱う。
- `agent-bridge`: Renderer のテキスト要求を Main の `pi-coding-agent` SDK に中継し、結果を応答として返す。
- `heartbeat-jobs`: 一定間隔のハートビートで事前登録した処理を実行する。

### Modified Capabilities
- なし

## Impact

- 影響コード: Electron エントリポイント、Main/Renderer 間通信層、エージェント統合層、ジョブ実行層。
- 依存関係: Electron、`pi-coding-agent`（Pi モノレポ由来パッケージ）。
- API/契約: IPC メッセージの入出力契約、エージェント実行リクエスト/レスポンス形式、ハートビートジョブ登録形式。
- 非対象: 音声認識、ウェイクワード検出、OS 固有の詳細最適化。
