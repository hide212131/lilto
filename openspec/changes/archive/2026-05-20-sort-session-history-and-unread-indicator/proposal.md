## Why

会話履歴は現在、作成時刻ベースで保持されており、cron や長時間推論で別セッションに新着メッセージが届いても常に最新更新順で並び替わる保証がありません。バックグラウンドで更新された会話を未読として識別できないため、ユーザーはどのセッションで新しい会話が発生したかを即座に判断できません。

## What Changes

- セッション一覧を常に「最後に会話内容が更新された時刻」の降順で表示する。
- メイン画面に表示していないセッションへ assistant/system/error メッセージが追加または更新された場合、そのセッションに未読マークを付ける。
- ユーザーが未読セッションをクリックしてメイン画面に表示した時点で未読状態を既読へ戻し、未読マークを消す。
- 既存セッション保存データを後方互換で扱えるよう、更新時刻と未読状態を欠く古い session record を安全に補完する。

## Capabilities

### New Capabilities

<!-- なし -->

### Modified Capabilities

- `renderer-chat-ui`: セッション一覧の並び順を会話更新順へ変更し、非表示セッションの新着会話を未読マークで示す requirement を追加する。

## Impact

- Renderer のセッション永続化モデルと一覧描画: [src/renderer/app.ts](/Users/hide/dev/lilto/src/renderer/app.ts), [src/renderer/components/chat-history.ts](/Users/hide/dev/lilto/src/renderer/components/chat-history.ts), [src/renderer/types.ts](/Users/hide/dev/lilto/src/renderer/types.ts)
- UI 契約テストの追加・更新: [test/new-session-ui-contract.test.js](/Users/hide/dev/lilto/test/new-session-ui-contract.test.js) と新規の session list 契約テスト
- localStorage に保存済みの session 配列に対する非破壊マイグレーション