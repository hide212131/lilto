## Context

現在の renderer は session 配列を localStorage にそのまま保存し、一覧表示も保存順をそのまま描画しています。新規 session 作成時だけ先頭へ追加されますが、既存 session へのメッセージ追加・更新では一覧の再配置を行っていないため、cron 通知や長時間推論の完了で別 session が更新されても最新会話が上に来る保証がありません。

また、session 型は `createdAt` と `messages` を中心に構成されており、「最後に更新された時刻」と「未読かどうか」を表す専用 metadata を持っていません。結果として、現在表示していない session に assistant 側の追記が入っても、一覧上で新着を区別できません。

## Goals / Non-Goals

**Goals:**
- session 保存モデルに `updatedAt` と `hasUnread` を追加し、古い localStorage データを安全に補完する。
- session のメッセージ追加・更新・作成・heartbeat 作成など、会話内容を変える経路で一貫して `updatedAt` を更新し、一覧を降順に保つ。
- 表示中でない session に新着 assistant/system/error メッセージが入ったときだけ未読状態を付与し、session を開いた時点で既読へ戻す。
- 右端の青いポチマークで未読を視覚化し、既存の active 表示やメニュー操作を壊さない。

**Non-Goals:**
- OS 通知センターの未読件数や dock badge の制御は追加しない。
- セッションごとの未読件数やメッセージ単位の既読位置は管理しない。
- Main process 側に新しい永続化ストアを導入しない。

## Decisions

### 1. Session metadata を renderer の保存モデルへ拡張する
- `Session` に `updatedAt: number` と `hasUnread?: boolean` を追加する。
- `_loadSessions()` で legacy record を正規化し、`updatedAt` が無い場合は `createdAt` か最後の message 時刻相当のフォールバックで補完する。
- `_saveSessions()` へ渡す前に一覧を `updatedAt` 降順へ整列する共通経路を設ける。

代替案:
- message 配列末尾の timestamp から毎回計算する案もあるが、既存 message 型に時刻が無く、永続データ互換と描画コストの両面で不利なため採用しない。

### 2. session 更新を共通 helper に集約する
- `_appendMessageToSession()` と `_updateSessionMessage()` は session を直接 `map()` で更新する代わりに、対象 session の `messages`・`updatedAt`・`hasUnread` をまとめて更新する helper を通す。
- unread は「対象 session が現在の表示 session ではない」かつ「新着内容が assistant/system/error 側の会話更新」である場合のみ `true` にする。
- `_openConversation()` では session を開く直前に既存編集中 session を保存し、開いた session 自体は `hasUnread = false` に戻した上で active 化する。

代替案:
- `requestUpdate()` 後に view 側で active session を除外して未読判定する案もあるが、永続化された session state と UI 表示がずれるため採用しない。

### 3. 一覧 UI はソート済み配列を受け取り、未読ドットだけを描画する
- `lilt-chat-history` は受け取った `sessions` をそのまま順に描画し、session item の右端に `hasUnread` 用の blue dot 要素を表示する。
- active session は選択済みなので unread dot を描画しない。クリック選択時は app 側で既読化して再描画する。
- 既存のメニュー操作や rename/delete 契約は維持し、未読表示は session-title/date と競合しないレイアウトに留める。

代替案:
- 未読表示をタイトル文字色や背景色だけで表す案は active 状態と衝突しやすく、視認性が不安定なため採用しない。

## Risks / Trade-offs

- [古い session record に metadata が無い] → `_loadSessions()` で正規化し、欠損値は `createdAt` ベースで補完してから保存する。
- [progress 更新など同一 message の patch で並び順が過剰に揺れる] → 会話として意味のある更新だけ `updatedAt` を進める条件を helper 側で定義し、単なる requestId 付与では順序を変えない。
- [background 更新判定を誤ると表示中 session にも unread が付く] → active session ID と対象 session ID の比較を helper に集約し、クリック選択時の既読化をテストで固定する。
- [heartbeat session や scheduler follow-up が新 metadata を通らず挙動差が出る] → すべての session 作成・更新経路を helper 利用へ寄せ、契約テストで通知経由の再配置を確認する。

## Migration Plan

- アプリ起動時に localStorage の session 配列を読み込み、各 record を新しい `Session` 形へ正規化する。
- 初回保存時に `updatedAt` と `hasUnread` を含む形へ再保存する。
- ロールバック時は追加 metadata を無視できるため、保存データ互換上の blocking migration は不要。

## Open Questions

- `updatedAt` を user 送信直後にも更新するか、assistant 応答確定時だけにするかは実装時に helper 条件を明確化する必要がある。ただし session 一覧は「最後に会話が動いた時刻」を表すため、少なくとも user 送信で前方へ移動する方針が妥当。
- 未読ドットの色 token を既存テーマ変数へ追加するか、component ローカルの色で始めるかは UI 実装時に判断する。