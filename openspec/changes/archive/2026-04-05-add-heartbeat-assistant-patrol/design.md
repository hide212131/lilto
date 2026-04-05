## Context

lilto にはすでに二つの定期実行系がある。`src/main/heartbeat.ts` は Main プロセス内の軽量な固定間隔ジョブ実行基盤で、`src/main/scheduler.ts` は scheduler daemon を使った永続化付き schedule 実行基盤である。ユーザーが求めているのは OpenClaw 風の heartbeat であり、これは「正確な時刻で何かを実行する」よりも、「定期的に状況を見回り、必要なときだけ静かに知らせる」機能である。

今回の変更では heartbeat を cron の別名として露出させるのではなく、ユーザー向けには heartbeat assistant として独立した機能を保ちつつ、内部の定期発火には既存の scheduler daemon を使う。これにより、定期実行の永続化と再起動復元は既存実装を再利用し、`HEARTBEAT.md`、通知抑制、`HEARTBEAT_OK` 契約といった heartbeat 固有の意味づけを別レイヤーで定義できる。

## Goals / Non-Goals

**Goals:**
- `HEARTBEAT.md` を巡回手順書として読み、定期的な background patrol を実行できるようにする。
- OpenClaw 互換寄りの `heartbeat_state.json` 構造で前回巡回状態を保持し、`lastChecks`・`lastNotified` を使って静かな巡回判定へ寄せる。
- `HEARTBEAT_OK` を user-facing な通知や session へ出さず、actionable finding だけを表面化する。
- heartbeat assistant の有効化、参照ファイル、基本設定を Settings から管理できるようにする。
- 重複通知抑制と前回実行状態を state に分離して保持し、同じ警告を繰り返し出さないようにする。
- 既存の scheduler daemon、Main runtime、Settings 保存基盤を再利用し、実装差分を最小化する。

**Non-Goals:**
- 毎日 9:00 のような正確時刻ジョブを heartbeat assistant で表現すること。
- メッセージ送信、削除、購入などの確定操作を heartbeat assistant が自動実行すること。
- OpenClaw 全体のクローンをこの change で実装すること。
- heartbeat assistant 用の専用エディタや複雑なルールビルダーを追加すること。

## Decisions

### 1. 定期発火は scheduler daemon の managed schedule で行う

heartbeat assistant の cadence は `setInterval` ベースの `HeartbeatScheduler` ではなく、既存の scheduler daemon に保持する managed recurring schedule で実行する。Main 起動時と heartbeat 設定更新時に、アプリが予約済みの internal schedule を再同期する。

この構成により、アプリ再起動後も cadence を維持でき、既存の schedule 復元や fired event 配送を再利用できる。代替案として `HeartbeatScheduler` に巡回ジョブを直接追加する方法もあるが、これだと再起動復元や将来の複数 cadence 管理を別途実装する必要があるため採用しない。

### 2. `HEARTBEAT.md` と state は必ず分離し、state は互換寄りの JSON 構造へ寄せる

`HEARTBEAT.md` は巡回手順書であり、保存済み状態や通知履歴の格納先にはしない。前回実行時刻、前回通知した finding、通知済みキー、既知 ID などは別の heartbeat state ファイルへ保存する。保存形式は `version`・`lastChecks`・`lastNotified`・`lastSeen` を中心とした `heartbeat_state.json` 互換寄りの構造とし、既存の `heartbeat-assistant-state.json` は読込時に正規化する。

これにより、ユーザーが編集する instruction source と、アプリが管理する runtime state を混同せずに済む。設定 JSON に `HEARTBEAT.md` 本文を埋め込む案や、state を markdown frontmatter に混在させる案は、編集競合と責務混在が大きいため採用しない。

### 3. 巡回実行は Main の専用 background path として扱い、`HEARTBEAT_OK` は配信しない

heartbeat assistant の実行は通常の Renderer 起点 `submitPrompt` と分離し、Main プロセスから呼び出せる専用の background patrol path とする。ここでは `HEARTBEAT.md`、現在時刻、`heartbeat_state.json` 相当の state を使って runtime を呼び出し、通常の会話履歴全体は渡さない。

返答が `HEARTBEAT_OK` のみなら結果は破棄し、user-facing session や OS 通知へは流さない。警告テキストがある場合だけ通知処理へ流す。通常の chat submit に混ぜる案は、Renderer 依存が増え、heartbeat の静かな background 実行と責務が衝突するため採用しない。

### 4. heartbeat assistant は report-only を標準契約にする

初期実装では heartbeat assistant に自動の確定操作をさせず、「見る」「知らせる」までに限定する。prompt と docs の両方で、送信、削除、購入などの確定操作を行わないことを明示する。

これにより、デスクトップ常駐アシスタントとしての安全性を先に固定できる。OpenClaw 互換性を理由に自動実行まで広げる案は、権限境界と誤操作リスクが大きいため後続 change に分離する。

### 5. Settings は既存 provider settings 基盤へ統合する

heartbeat assistant の保存モデルは `ProviderSettings` に `heartbeatSettings` を追加して扱う。最低限、`enabled`、`filePath`、`intervalMinutes`、`showDesktopNotifications` のような設定を持たせ、Renderer の Settings modal から編集できるようにする。

既存の save/load、IPC、preload bridge を流用できるため、新しい設定ストアは作らない。別 JSON を新設する案は保存場所が増え、設定 UX と実装境界の両方が複雑になるため採用しない。

### 6. heartbeat assistant の managed schedule は通常の user schedule と分ける

heartbeat assistant 用の schedule は内部予約 ID を持つ system-managed schedule とし、user が AI 経由で作成する cron schedule と区別する。Settings 上でも `Schedules` タブとは別の heartbeat assistant 設定として見せ、通常の schedule 一覧から誤って削除させない。

heartbeat を通常の cron item として一覧に混ぜる案は、「何を時刻指定ジョブとして管理しているのか」と「静かな巡回が有効なのか」が同じ UI に混在し、誤削除や誤解を招きやすいため採用しない。

### 7. 同一内容の再通知抑制は `lastNotified` の stable key を優先する

heartbeat assistant は毎回の巡回結果をそのまま通知せず、finding ごとの stable key を `lastNotified` に保持して再通知を抑制する。runtime から stable key を得られない場合だけ normalized response fingerprint へフォールバックする。state が示す前回値と今回値が変化したときのみ再通知する。

これにより 30 分おきの同一警告連打を避けられる。LLM 出力の完全一致だけで抑制する案は、文面ゆれで破綻しやすいため採用しない。

### 8. actionable finding のみを既存の通知経路へ流す

heartbeat assistant の表面化は `HEARTBEAT_OK` や duplicate suppression の結果を含めず、actionable finding が出たときだけ既存の通知経路へ流す。現行 lilto の renderer では heartbeat finding を専用 session として見せられるため、その経路は finding の運搬路としてだけ利用する。

これにより OpenClaw 互換の「問題がないときは黙る」契約を守りつつ、actionable finding のみを lilto 側の既存 UX へ載せられる。毎回の OK 結果を session に積む案は、この互換性と矛盾するため採用しない。

## Risks / Trade-offs

- [scheduler daemon を内部利用するため internal schedule の扱いが user schedule と混ざる] → 予約 ID と system-managed フラグを導入し、UI と list API で区別する。
- [`HEARTBEAT.md` の置き場所が不明確だと設定が迷子になる] → 初期実装では明示 path を Settings に保存し、docs に推奨配置を記載する。
- [background runtime 実行が通常会話と同じ重さになる] → 軽量コンテキスト専用 path を定義し、巡回入力を最小限に制限する。
- [LLM から stable key が返らない] → `KEY:` 行を求める prompt へ寄せ、取れない場合だけ normalized fingerprint にフォールバックする。
- [認証切れや設定不足で巡回が失敗し続ける] → 失敗を静かに握りつぶさず、Settings とログで観測できる status を残す。

## Migration Plan

heartbeat assistant は初期状態では無効にする。既存ユーザーを surprise させないため、更新後に勝手に internal schedule は作成しない。ユーザーが Settings で有効化し、`HEARTBEAT.md` の参照先を保存した時点で初めて managed schedule を生成する。

無効化した場合は reserved internal schedule を削除し、state は残しても再実行しない。rollback 時は `heartbeatSettings` を無視しても既存 provider settings 読み込みが壊れないよう、後方互換な default を維持する。既存の `heartbeat-assistant-state.json` を使っている環境では、新しい state 読込時に互換正規化し、新しい書き込みは `heartbeat_state.json` へ集約する。

## Open Questions

- 初期 UI で `HEARTBEAT.md` の path をテキスト入力だけにするか、ファイル選択ダイアログまで含めるかは実装時に工数を見て判断する。最初はテキスト入力のみでも要件は満たせる。