## Context

設計書 `lilto-dev/designs/session-archive-delete-design.md`（Issue #40）と、その「司令塔の範囲判断（追補）」の要約。追補が設計本体に優先する。

## Decisions

| 項目 | 決定 |
|---|---|
| メニュー | 名称変更／アーカイブ／削除。削除のみ危険色。button 要素 |
| 確認 | 削除のみ `globalThis.confirm`。文面「「{タイトル}」を完全に削除しますか？\nこの会話は復元できません。」。タイトルは空白・改行を整形し、空は「名称未設定の会話」、120 コードポイント超は末尾「…」 |
| IPC | `conversations:delete` `{conversationId}` → `{ok:true}` / `{ok:false,error:{code,message}}`。archive の契約は不変 |
| エラーコード | INVALID_REQUEST / CONVERSATION_UNSUPPORTED / CONVERSATION_BUSY / CONVERSATION_HAS_SCHEDULES / CONVERSATION_SCHEDULE_CHECK_FAILED / CONVERSATION_UNAVAILABLE / CONVERSATION_ARCHIVE_FAILED / CONVERSATION_DELETE_FAILED |
| main の防御 | モジュール内の処理中 Set、heartbeat ID 拒否、`preparingRuns` と `AgentRuntime.isConversationRunning`、`scheduler.listSchedules()` による参照確認（取得失敗は拒否）、成功時 `AgentRuntime.forgetConversation` |
| renderer の防御 | 処理中 Set、除去済み ID の保持（`_loadSessions` の遅延結果から復活させない）、実行中・既知のスケジュール参照は IPC 前に拒否 |
| 成功後 | 一覧・未読・preview invalidate（成功後）・下書き・loop 状態・完了要求を整理。表示中なら選択解除後に下書きを破棄（switchDraft による再保存を防ぐ） |
| 失敗表示 | サイドバー上部の専用 alert 領域。次の有効な操作開始で消す。自動消去なし |

## Risks

- scheduler 起点の実行との競合は塞がない（上記の受け入れる残存リスク）。
- アーカイブの復元入口は提供しない。
