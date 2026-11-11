## Why

サイドバーの会話メニューは「削除」と表示しながら実際には `thread/archive` を呼んでおり、表示と処理が一致しない。失敗は無言で戻り、実行中やスケジュール参照のある会話も区別なく処理される（Issue #40）。

## What Changes

- メニューを「名称変更」「アーカイブ」「削除」の 3 項目（削除のみ危険色、項目は button）にする。
- アーカイブ: 既存 `conversations:archive` を維持。確認なしで実行し、成功後に通常一覧から除去する。
- 削除: 新規 IPC `conversations:delete`（→ `thread/delete`）。renderer が `globalThis.confirm` で確認する。
- アーカイブ／削除とも、実行中・スケジュール参照あり・heartbeat assistant のセッションを拒否する（renderer 判定＋main 再検証。スケジュール確認失敗時も拒否）。
- 失敗はサイドバー上部の `role="alert"` 領域に「「{タイトル}」を{アーカイブ／削除}できません: {理由}（{code}）」で表示する。閉じる操作付き、自動消去なし。
- 成功後の後処理（一覧・下書き・プレビュー・loop 状態・main の対象キャッシュ）を共通化する。

## Capabilities

### Modified Capabilities

- `renderer-chat-ui`: 「削除相当操作で archive」のシナリオを、明示的な archive と確認付き delete に分離する。
- `cron-scheduler-tool`: スケジュールが参照する会話の archive／delete を拒否する要件を追加する。

## Impact

- Main: `conversation-history.ts`（`deleteConversation`）、`ipc/agent-conversation.ts`、`ipc.ts`、`agent-sdk.ts`（公開メソッド 2 つ）、`preload.ts`。
- Renderer: `chat-history.ts`、`app.ts`、`composer.ts`、`types.ts`。

## Non-goals

横断的な会話調停器（実行開始・スケジュール作成までの排他）、アーカイブ一覧／復元 UI、スケジュールの連鎖削除、heartbeat 履歴のローカル削除、アクティビティ表示へのメニュー追加（フォローアップ候補）。

## Accepted residual risk

busy 判定の直後にスケジューラ起点の実行が始まる競合は塞がない。その場合も App Server の成否は失敗表示で利用者に伝わる。外部 Codex クライアントの同時操作は対象外。
