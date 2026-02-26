## Why

現在の lilto では実行進捗として「考え中...」の状態は見えるものの、モデルが出力している thinking 本文を確認できず、read/bash などのツール実行に至る判断過程の追跡が難しいです。調査性とデバッグ効率を上げるため、thinking 本文を安全に表示できる仕様を追加する必要があります。

## What Changes

- エージェント実行イベントに thinking 本文（増分）を含めて、main から renderer へ中継できるようにする。
- renderer 側で pending の assistant メッセージに thinking セクションを表示し、既存の進捗表示（ツール開始など）と併存させる。
- thinking セクションはデフォルト折りたたみとし、長文は先頭プレビュー＋追加展開で閲覧できるようにする。
- thinking セクションの開閉状態はセッション中の再描画で維持する。
- 開閉状態の管理キーは requestId を優先し、requestId 未設定時のみ message ID にフォールバックする。
- thinking が出ないモデル/ターンでも既存挙動が壊れないよう、表示はオプショナルデータとして扱う。
- 既存の `submitPrompt` の戻り値契約は変更せず、追加情報は loop event 経由でのみ受け渡す。

## Capabilities

### New Capabilities
- `thinking-visibility`: エージェントの thinking 本文を実行中UIへ段階的に表示する機能要件を定義する。

### Modified Capabilities
- なし

## Impact

- 影響コード: `src/main/agent-sdk.ts`, `src/shared/agent-loop.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/app.ts`, `src/renderer/components/message-list.ts`, `src/renderer/types.ts`
- IPC/イベント: `agent:loopEvent` の payload 型拡張（後方互換を維持）
- 依存: 新規外部依存は不要
- UX: 実行中 assistant バブルに thinking 本文が追加表示される
- UX: 実行中 assistant バブルで `Status / Thinking / Running command / 最終回答` を分離表示し、長文は段階展開で閲覧できる
- UX: Thinking の展開状態は同一実行ターン（requestId）で安定して維持される
