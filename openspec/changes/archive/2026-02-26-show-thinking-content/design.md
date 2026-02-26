## Context

lilto は `agent:loopEvent` を介して renderer に進捗を通知し、実行中は pending の assistant メッセージへ進捗テキストを追記しています。現状の loop event は `thinking_start` / `thinking_end` の状態イベントのみで、thinking 本文（`thinking_delta`）を保持していません。そのため、モデルの判断過程を UI 上で確認できません。

制約として、`submitPrompt` の戻り値契約は既存テストとUIが依存しているため変更しません。追加情報は既存の loop event チャネルに限定して後方互換で拡張します。

## Goals / Non-Goals

**Goals:**
- main レイヤーで `message_update` の `thinking_delta` を捕捉し、loop event として renderer へ転送する。
- shared 型に thinking 本文イベントを追加し、型安全に renderer まで受け渡す。
- renderer で pending assistant バブルに thinking 本文を段階表示する。
- thinking 非対応モデルや thinking が空のケースで既存表示を維持する。

**Non-Goals:**
- モデル選択・thinking level 設定UIの新設。
- thinking 本文の永続化（セッション保存）やエクスポート。
- 新しい IPC チャネル追加や `submitPrompt` レスポンス拡張。

## Decisions

1. **loop event に `thinking_delta` を追加する**
   - 選択: `AgentLoopEvent` に `thinking_delta`（`requestId`, `delta`）を追加。
   - 理由: 既存のイベント配信基盤を再利用でき、main/renderer の変更範囲が最小。
   - 代替案: `run_end` で thinking 全文を一括返却。
     - 不採用理由: 実行中可視化ができず、長い thinking の追跡性が低い。

2. **thinking 収集は `message_update` のみを一次ソースにする**
   - 選択: `assistantMessageEvent.type === "thinking_delta"` を捕捉して逐次送信。
   - 理由: pi-coding-agent の標準ストリームイベントに沿い、実装が単純。
   - 代替案: `message_end` の assistant content から `thinking` ブロック抽出。
     - 不採用理由: 遅延表示になり、途中経過が見えない。

3. **renderer では progress 行と thinking 本文を分離して表示する**
  - 選択: `status / thinking / tools` を構造化データとして保持し、assistant バブル内でセクション表示する。
   - 理由: 既存の「ツール開始」可視化を壊さず追加できる。
   - 代替案: thinking を system メッセージとして別吹き出し表示。
     - 不採用理由: チャットが冗長化し、1ターン内の関連性が下がる。

4. **thinking はデフォルト折りたたみ + 長文は段階展開にする**
  - 選択: thinking 本体は `details` で初期クローズ、先頭 N 行のみ表示し、残りは「残り X 行を表示」で展開。
  - 理由: 実行中の視認性を維持しつつ、必要時に全文へアクセスできる。
  - 代替案: 常時全文表示。
    - 不採用理由: 長文時にコマンド進捗が埋もれて可読性が落ちる。

5. **開閉状態はコンポーネント状態で保持する**
  - 選択: requestId を第一キー、message ID をフォールバックキーとして開閉状態を保持し、再描画時に `.open` を復元。
  - 理由: ストリーミング更新時の再レンダリング維持に加え、将来のメッセージ挿入/削除でも状態の誤適用を避けられる。
  - 代替案: DOM の `details` 状態に任せる。
    - 不採用理由: 再レンダリングで初期化されやすい。

## Risks / Trade-offs

- [Risk] thinking が大量出力されると pending バブルが長くなり可読性が低下 → Mitigation: 先頭 N 行プレビュー + 追加展開で初期表示の情報量を制御する。
- [Risk] provider により `thinking_delta` が来ないケースがある → Mitigation: 受信時のみ追記し、未受信時は既存進捗表示のみ。
- [Risk] `thinking` に機密文が含まれる可能性 → Mitigation: 本変更ではローカル表示のみ。外部送信や永続化は行わない。

## Migration Plan

1. `src/shared/agent-loop.ts` に `thinking_delta` イベント型を追加。
2. `src/main/agent-sdk.ts` で `message_update` から `thinking_delta` を loop event 化。
3. `src/renderer/app.ts` で thinking バッファを保持し pending 表示へ反映。
4. `src/renderer/components/message-list.ts` で `details` ベースの折りたたみ表示、行数プレビュー、追加展開を実装。
5. `src/renderer/app.ts` で `run_start` の `requestId` を pending assistant メッセージへ紐付ける。
6. `src/renderer/components/message-list.ts` で開閉状態を requestId 優先（fallback: message ID）で保持し、再描画時に復元。
7. 型チェック（`npx tsc -p tsconfig.json --noEmit`）と GUI E2E（`npm run e2e:electron`）で回帰確認。

Rollback:
- 追加した `thinking_delta` ハンドリングを削除し、既存 `thinking_start` / `thinking_end` のみへ戻す。

## Open Questions

- thinking 表示の ON/OFF をユーザー設定として追加するか（現状は常時利用可能）。
