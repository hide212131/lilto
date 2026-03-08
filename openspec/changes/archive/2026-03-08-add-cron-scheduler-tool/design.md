## Context

現在の lilto は、ユーザー入力を受けてその場で Pi SDK を実行する構成であり、将来時刻に処理を再開したり、会話セッションへ非同期イベントを差し込んだりする基盤を持っていません。一方で、既存 Main プロセスには通知サービス、IPC 配信、ループイベント中継がすでにあり、スケジュール発火をこの経路へ接続できれば UI 追加を最小限に抑えられます。

要件上の難所は次の3点です。

- AI が自然言語から予定を解釈し、Custom Tool として登録・一覧・変更・削除を行えること
- アプリ再起動後も予定を失わず、期限到来時に対象セッションへ通知できること
- Electron 配布物の中で Rust バイナリを安定起動し、異常終了時も Main 側で観測・復旧できること

## Goals / Non-Goals

**Goals:**
- Pi の Custom Tool として `cron` ツールを定義し、AI が one-shot / recurring タスクを CRUD できるようにする。
- Rust daemon にスケジュール実行責務を集約し、SQLite 永続化と起動時リハイドレートを提供する。
- 発火イベントに `sessionId` と完了メッセージを含め、Main から対象チャットへ通知を挿入できるようにする。
- scheduler の正常系・異常系を Electron Main で観測し、ユーザー通知とログに反映する。

**Non-Goals:**
- この change で複雑なカレンダー UI や専用スケジュール管理画面を追加しない。
- 分散ジョブ実行、複数端末同期、サーバーサイド配信は扱わない。
- 初回実装で秒単位の高頻度ジョブ、再試行ポリシー、依存ジョブ DAG までは扱わない。

## Decisions

1. **Scheduler は Rust 常駐 daemon として分離する**
   - Electron Main から `spawn()` で子プロセス起動し、標準入出力の JSON Lines でコマンドとイベントをやり取りする。
   - 理由: cron 待機・時刻計算・永続化を Node 側イベントループから分離し、長寿命処理を安定させたい。
   - 代替案: Node/TypeScript だけで scheduler を実装する。
   - 不採用理由: 配布後の長時間待機・時間帯処理・永続化の責務が Main に集中し、agent 実行との干渉面が広い。

2. **永続化は daemon ローカル SQLite を正とする**
   - スケジュール定義を `app.getPath("userData")` 配下 DB に保存し、起動時に有効ジョブを再登録する。
   - 理由: 単一端末アプリの要件には十分で、配布も `rusqlite` bundled で閉じられる。
   - 代替案: Electron 側 JSON ファイル保存、または外部 DB。
   - 不採用理由: JSON は同時更新や検索が弱く、外部 DB は導入負荷が過剰。

3. **`cron` tool は高水準 API を優先し、低水準 CRUD をフォールバックとして残す**
   - tool の操作は `set_timer`, `set_reminder_at`, `set_daily_reminder`, `list`, `delete` を高頻度ケース向けに提供し、複雑なケースのみ `create`, `update` で直接 `runAt` / `cronExpr` を受け付ける。
   - `set_timer` は `afterSeconds` を受け、tool 内で one-shot `runAt` に正規化する。`set_reminder_at` は `date` (`YYYY-MM-DD`) と `time` (`HH:MM` または `HH:MM:SS`) と `timezone` を受け、tool 内で RFC3339 に組み立てる。`set_daily_reminder` は `hour` / `minute` / `timezone` を受けて日次 cron を生成する。
   - すべての登録・更新経路で `notification.sessionId` と `notification.message` を必ず保持し、必要に応じて `notification.followUpInstruction` を保存する。
   - 理由: 「3分後」「明日 9 時」「毎日 18 時」のような頻出指示で AI に cron 式や RFC3339 を直接組み立てさせると、引数生成失敗率が高くなるため。
   - 代替案: 低水準 API のみを維持し、プロンプトで書式を厳格に教える。
   - 不採用理由: 書式自由度が高いままでは、AI 側の一時的な解釈揺れで登録自体が失敗しやすい。

4. **発火イベントは Main が中継し、Renderer が会話へ書き戻す**
   - daemon は `fired` イベントに通知文言と optional な `followUpInstruction` を含めて返し、Main はその payload を window へ中継する。Renderer が `backendSessionId` から対象会話を解決し、チャットへのシステムメッセージ追加と必要時の follow-up 実行を担当する。
   - 理由: daemon を UI 非依存に保ちつつ、既存の NotificationService と IPC 契約を再利用できる。
   - 代替案: daemon から直接 renderer へ通知する。
   - 不採用理由: ネイティブプロセスから Electron window 管理に直接触れられず、責務境界も崩れる。

5. **scheduler 発火後の follow-up は Renderer が同一会話へ再投入する**
   - `followUpInstruction` がある schedule 発火時は、Renderer が対象 conversation を `backendSessionId` から解決し、通知システムメッセージをチャットへ追加した後、同じ conversationId で `submitPrompt` を呼び出して agent runtime を再実行する。
   - Renderer が agent runtime へ渡す follow-up prompt には、通知文言と follow-up 指示を含める。AI はまず必要なら短く何をするかを伝え、その後に指示された処理を続ける。
   - 理由: 会話履歴と `conversationId` の正は Renderer が持っており、通知メッセージと後続 assistant 応答の表示順序を最も簡単に維持できるため。
   - 代替案: Main が `backendSessionId` を conversation へ逆引きして follow-up を実行する。
   - 不採用理由: conversation 解決情報を Main が永続保持しておらず、既存構造のままでは UI への書き戻し順序も保証しにくい。

6. **Renderer の会話セッションと Pi session を明示的に対応付ける**
   - Main のエージェント実行は `conversationId` ごとに Pi session を分離し、`session_bound` loop event で backend session ID を Renderer へ返す。
   - Renderer は `backendSessionId` を local session に保存し、scheduler 通知を正しい会話へ書き戻す。
   - 理由: 既存 UI の local session ID と Pi SDK の session ID は別物であり、そのままでは通知先を解決できないため。
   - 代替案: Renderer の session ID をそのまま daemon へ保存する。
   - 不採用理由: Pi custom tool から取得できるのは SDK session ID であり、UI 独自 ID を逆引きできない。

7. **スケジュール変更は「新規登録 + 旧ジョブ無効化」で実装する**
   - update 操作では既存ジョブを論理削除し、新しい定義を再登録する。
   - 理由: ランタイム上のジョブ差し替え API を複雑化せず、DB 上の監査情報も残しやすい。
   - 代替案: in-memory job を直接 mutate する。
   - 不採用理由: 再起動復元ロジックと整合を取りづらい。

8. **エラーは tool レベルと daemon レベルで分けて標準化する**
   - 入力不正、重複 ID、存在しない schedule、session 不達、daemon 異常終了を区別し、AI と UI の双方が扱えるエラーコードへマップする。
   - 理由: AI が再試行やユーザー説明を行うには、単なる文字列エラーでは粒度が足りない。

## Risks / Trade-offs

- **[Risk] daemon 異常終了で新規登録や通知送達が止まる**
  - Mitigation: Main で exit/ready を監視し、自動再起動と未処理イベントのログ出力を行う。

- **[Risk] sessionId が無効化された後にジョブが発火し、チャットへ書き込めない**
  - Mitigation: 発火時に session 存在確認を行い、不達時は OS 通知と監査ログへフォールバックする。

- **[Risk] AI が低水準 API を選んで再び cron/RFC3339 生成に失敗する**
  - Mitigation: tool description と parameter schema で高水準 operation を先に提示し、低水準 `create` / `update` は「複雑な繰り返し向け」と明示する。

- **[Risk] follow-up 指示が曖昧で、発火後の AI 実行が意図しない操作を行う**
  - Mitigation: `cron` tool の follow-up 指示は「発火後に AI が行う具体的な一文」に限定し、登録時に tool 側 description で明示する。Main は follow-up prompt に通知文言と指示を明確に分けて埋め込む。

- **[Trade-off] Rust バイナリ同梱で build/package が重くなる**
  - Mitigation: native ディレクトリを明確に分離し、開発・配布の build 手順を tasks とテストに固定する。

- **[Trade-off] 開発環境で Rust バイナリ未ビルド時は scheduler が unavailable になる**
  - Mitigation: Main 起動自体は継続し、scheduler 起動失敗はログ化する。`npm run build:native` を別導線で用意し、配布時は `extraResources` へ含める。

## Migration Plan

1. native daemon プロジェクトを追加し、ローカル実行で JSON command / event 契約を固める。
2. Electron Main に daemon supervisor と scheduler service を導入し、手動登録 API で疎通確認する。
3. Pi Custom Tool と agent runtime を接続し、AI から CRUD できることを確認する。
4. Renderer 側へ scheduler 通知イベントを表示し、非フォーカス時の OS 通知を連携する。
5. packaging と E2E を通し、アプリ再起動後の復元を確認する。

## Tool API Shape

- 高水準 operation
  - `set_timer`: `afterSeconds`, `title?`, `notificationMessage?`, `followUpInstruction?`
  - `set_reminder_at`: `date`, `time`, `timezone?`, `title?`, `notificationMessage?`, `followUpInstruction?`
  - `set_daily_reminder`: `hour`, `minute`, `timezone?`, `title?`, `notificationMessage?`, `followUpInstruction?`
- 低水準 operation
  - `create`: `kind`, `runAt?`, `cronExpr?`, `timezone?`, `title?`, `notificationMessage?`, `followUpInstruction?`
  - `update`: `id` + `create` と同等
  - `list`: `scope?`
  - `delete`: `id`

高水準 operation は tool 内で既存の `SchedulerCreateInput` に正規化し、Rust daemon との JSON 契約は変更しない。

ロールバック時は `cron` tool を未登録に戻し、Main の daemon 起動を無効化すれば既存チャット機能へ戻せる。

## Open Questions

- session 単位のチャット履歴に「scheduler system message」をどの型で保存するか。既存 assistant message と分けるか、通知専用 role を追加するか。
- update/delete 時にユーザーへ見せる schedule ID を AI 内部 ID と同一にするか、人間向けラベルを別持ちするか。
- アプリ終了中に期限を迎えた one-shot ジョブを、次回起動時に即時通知するか失効扱いにするか。
- follow-up 実行が別の assistant 応答として見える場合、チャット UI 上で「scheduler 由来の follow-up」であることをどこまで明示するか。
