## Context

`lilt-top-bar` には既にプラスボタン（`title="New"`）が描画されているが、クリックイベントが未接続で新規セッション開始として機能していない。現在の `lilt-app` は `messages`、`isSending`、`loopState`、進行ログ（`_progressLines`）を保持しており、会話のやり直しにはこれらの一括初期化が必要である。

## Goals / Non-Goals

**Goals:**
- プラスボタン押下で新規セッション開始イベントを発火できるようにする。
- `lilt-app` がイベントを受けて会話履歴と進行表示を初期状態へ戻せるようにする。
- 送信中に誤ってセッションをクリアしないよう、送信中は新規セッション操作を無効化する。

**Non-Goals:**
- セッション履歴の永続化・切り替え UI（History ボタン活用を含む）の実装。
- Main プロセス側のセッション管理 API 追加。
- 既存の設定モーダルやプロバイダー設定フローの仕様変更。

## Decisions

1. `lilt-top-bar` に `new-session` カスタムイベントを追加する。
理由: 既存の `open-settings` と同じイベント連携パターンを維持でき、責務分離が明確。
代替案: `lilt-app` からトップバー DOM を直接参照してクリック監視する案は、コンポーネント疎結合を壊すため不採用。

2. `lilt-app` に `_onStartNewSession` を実装し、以下を同時初期化する。
- `messages = []`
- `loopState = createInitialLoopState()`
- `_pendingAssistantIndex = null`
- `_progressLines = []`
理由: 進行表示は pending メッセージに埋め込まれるため、履歴と内部進行状態を同時に消去しないと表示不整合が残る。
代替案: メッセージのみ削除する案は、内部進行状態が残って次回送信へ影響するため不採用。

3. 送信中（`isSending === true`）はプラスボタンを disabled にする。
理由: 進行中リクエストを中断できない現仕様で履歴だけ消すと UX が不安定になるため、まず安全側に倒す。
代替案: 送信中でもクリア可能にし、結果返却時に破棄する案は追加状態管理が必要で、今回の最小変更方針に合わないため不採用。

## Risks / Trade-offs

- [Risk] 送信中は新規セッション開始できないため、即時リセットしたいユーザー要求を満たしきれない。  
  → Mitigation: ボタンの disabled 状態を明示し、将来的に中断 API が導入された時点で再検討する。
- [Risk] `messages=[]` でローカル履歴が完全に消えるため、誤操作時に復元できない。  
  → Mitigation: 今回はセッション開始操作として明示し、将来の履歴機能を別 change で扱う。

## Migration Plan

- Renderer 実装で `new-session` イベントと状態初期化処理を追加。
- 単体テストまたは GUI E2E で、プラスボタン押下後にメッセージ消去と再送可能状態を検証。
- ロールバック時は `new-session` 連携を除去し、既存表示のみへ戻す。

## Open Questions

- なし（送信中は disabled とする方針で確定）。
