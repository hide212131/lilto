以下は、これまでの話をふまえてまとめた **OpenClaw 風クローン用の仕様書案**です。
先に大事な点を言うと、OpenClaw 本体で公式に固まっているのは「heartbeat は既定で 30 分ごとに走る」「`HEARTBEAT.md` があればそれを厳密に読む」「何もなければ `HEARTBEAT_OK`」「その返答は外に出さない」というところまでです。`heartbeat_state.json` については、公開例はありますが、正式な固定スキーマまでは確認できませんでした。なので、下の仕様は **OpenClaw 互換の最小条件** と **クローンとして決める標準** を分けて書いています。 ([OpenClaw][1])

---

# 1. 文書の目的

本仕様は、デスクトップ AI アシスタントにおける heartbeat 実行のために使う 2 つのファイル、`HEARTBEAT.md` と `heartbeat_state.json` の役割、形式、読み方、更新ルールを定めるものとする。

heartbeat は「正確な時刻に必ず実行する仕組み」ではなく、「一定間隔で見回って、必要なことだけ知らせる仕組み」として扱う。正確な時刻が必要な処理は cron など別の仕組みに分ける。これは OpenClaw の公式の使い分けに合わせる。 ([OpenClaw][2])

---

# 2. 仕様の前提

## 2.1 heartbeat の実行

アプリケーションは heartbeat を既定で **30 分ごと**に起動する。必要なら設定で変更してよい。OpenClaw でも既定は 30 分で、無効化は `0m` で行う。heartbeat はフルの agent turn として動くため、間隔を短くするとトークン消費は増える。 ([OpenClaw][1])

## 2.2 heartbeat の基本プロンプト

heartbeat 実行時、モデルには次の意味の指示を与える。

* `HEARTBEAT.md` があれば読む
* その内容に厳密に従う
* 過去の会話から古い未処理を勝手に推測して増やさない
* 何も注意がなければ `HEARTBEAT_OK` を返す

これは OpenClaw の既定の heartbeat prompt に合わせたものとする。 ([OpenClaw][1])

## 2.3 返答の扱い

モデルの返答が `HEARTBEAT_OK` のみ、またはそれに準ずる短い確認応答である場合、アプリケーションはその heartbeat 結果をユーザーへ配信しない。OpenClaw でも `HEARTBEAT_OK` は外向き配信を抑制する。 ([OpenClaw][1])

---

# 3. `HEARTBEAT.md` 仕様

## 3.1 目的

`HEARTBEAT.md` は、heartbeat 実行時にモデルが参照する **定期見回りの手順書** とする。
このファイルには「何を確認するか」「どんな時だけ報告するか」「何もなければどう返すか」を書く。人格設定や長い運用方針は別ファイルに分ける。OpenClaw の公式でも、heartbeat 用には小さな checklist を置くことが勧められている。 ([OpenClaw][3])

## 3.2 存在しない場合の扱い

`HEARTBEAT.md` が存在しない場合でも heartbeat 自体は実行してよい。このときモデルは、他の与えられた文脈だけで判断する。これは OpenClaw の既定動作に合わせる。 ([OpenClaw][1])

## 3.3 空ファイルの扱い

`HEARTBEAT.md` が、空行と見出しだけで実質空である場合、アプリケーションは heartbeat API 呼び出し自体を省略してよい。OpenClaw でも、実質空の `HEARTBEAT.md` は API 呼び出し節約のためにスキップされる。 ([OpenClaw][1])

## 3.4 形式

`HEARTBEAT.md` の形式は Markdown とする。厳密な構文は定めないが、少なくとも次の 3 つを含むことを推奨する。

1. 確認項目
2. 報告条件
3. 出力ルール

公開されている OpenClaw の runbook 例でも、この形で書かれている。 ([GitHub][4])

## 3.5 記述ルール

`HEARTBEAT.md` には次の内容を書く。

* 確認対象
  例: 新着通知、今後 2 時間の予定、止まっているタスク
* 報告条件
  例: 前回から新しい変化がある、期限が近い、エラーが起きている
* 報告しない条件
  例: 変化がない、単なる確認だけ、緊急でない
* 出力ルール
  例: 何もなければ `HEARTBEAT_OK`

OpenClaw の runbook 例では、メール、予定、タスク、Git、システム監視のような複数チェックを持ち、各チェックに「Report ONLY if」と「Update」を書いている。 ([GitHub][4])

## 3.6 書いてはいけない内容

`HEARTBEAT.md` には、heartbeat のたびに重い処理や広すぎる判断を要求する曖昧な文をできるだけ書かない。
たとえば「何でも見て適切に行動する」より、「予定を見て 2 時間以内なら知らせる」の方がよい。heartbeat は定期監視向けであり、短く具体的な方が OpenClaw の設計と合う。 ([OpenClaw][3])

## 3.7 最小サンプル

```md
# HEARTBEAT.md

## 確認項目
- 新着通知や新着メッセージの中に、早めに見た方がよいものがあるか
- 今後2時間以内に予定やリマインドがあるか
- 進行中タスクの中に、失敗したものや止まっているものがあるか

## 報告条件
- ユーザーが今知った方がよいことがある
- 前回から状態が変わった
- 期限や開始時刻が近い
- エラーや停止が起きている

## 報告しない条件
- 前回と同じ内容で変化がない
- 対応が不要
- 緊急でない単発の雑多な通知だけ

## 出力ルール
- 対応が不要なら HEARTBEAT_OK を返す
- 報告するときは1件ずつ短く書く
- 推測で未処理を増やさない
- 自動で確定操作はしない
```

---

# 4. `heartbeat_state.json` 仕様

## 4.1 目的

`heartbeat_state.json` は heartbeat の前回実行状態を保存するファイルとする。
主な用途は、各チェックの前回実行時刻を記録し、どのチェックを今回回すかを決めることと、同じ通知を短時間で繰り返さないことにある。

ここで注意が要るのは、OpenClaw の公開情報には `heartbeat-state.json` の正式固定スキーマは見当たらないことです。確認できるのは `lastChecks` を持つ例と、「最も overdue な check を 1 つ選んで回す」という runbook の実装例までです。したがって本仕様では、**OpenClaw 互換の最小要件** と **クローンの標準拡張** を分ける。 ([OpenClaw][5])

## 4.2 OpenClaw 互換の最小要件

最低限、次の JSON オブジェクトをサポートする。

```json
{
  "lastChecks": {
    "email": 1703275200,
    "calendar": 1703260800,
    "weather": null
  }
}
```

この形式は OpenClaw の公式テンプレート例にある。なお、公開 runbook 例ではミリ秒の Unix 時刻も使われているため、時刻の単位は実装側で固定して扱う必要がある。 ([OpenClaw][5])

## 4.3 本クローンでの標準形式

本クローンでは、時刻は **Unix time のミリ秒** に統一し、次の形式を標準とする。

```json
{
  "version": 1,
  "lastChecks": {
    "messages": null,
    "calendar": null,
    "tasks": null,
    "git": null,
    "system": null
  },
  "lastNotified": {},
  "lastSeen": {
    "messageIds": [],
    "eventIds": [],
    "taskIds": []
  }
}
```

`lastChecks` は公開例にある最小構造を引き継ぐ。`lastNotified` と `lastSeen` は、同じ内容の再通知を抑え、前回からの変化を安定して判断するために、このクローンで追加する拡張項目とする。公開の runbook 例では「前回から新しい予定があれば報告」「前回の timestamp を更新」としているが、通知抑制の細かなキー設計までは固定されていない。 ([GitHub][4])

## 4.4 各フィールドの意味

### `version`

状態ファイルのバージョン番号。互換性管理のために持つ。初期値は `1`。

### `lastChecks`

各チェック種別について、最後にそのチェックを実行した時刻を持つ。
キーは実装が扱うチェック種別名と一致させる。値が `null` の場合、そのチェックはまだ一度も実行されていないことを表す。

### `lastNotified`

通知済みの安定キーと、その通知を最後に出した時刻を持つ。
例: `"calendar:event-abc123:2h-warning": 1710001800000`

### `lastSeen`

元データの既読・確認済み状態を持つ。
文字列一致でなく、元データの ID で「新しいものかどうか」を判断するために使う。

## 4.5 書式上の制約

`heartbeat_state.json` は UTF-8 の JSON とし、トップレベルはオブジェクトでなければならない。
不明なフィールドがあっても読み飛ばしてよい。これにより将来の拡張をしやすくする。

## 4.6 初期値

初回起動時、ファイルが存在しなければ次の初期値を作成する。

```json
{
  "version": 1,
  "lastChecks": {},
  "lastNotified": {},
  "lastSeen": {
    "messageIds": [],
    "eventIds": [],
    "taskIds": []
  }
}
```

---

# 5. heartbeat 実行時の処理仕様

## 5.1 実行の流れ

heartbeat 1 回あたりの処理は次の順で行う。

1. `HEARTBEAT.md` を読む
2. `heartbeat_state.json` を読む
3. 各チェックについて「今回実行すべきか」を判定する
4. 実行対象のチェックだけを回す
5. `lastChecks` を更新する
6. 変化があり、かつ通知条件を満たすときだけ報告する
7. そうでなければ `HEARTBEAT_OK` を返す

この流れは、公開されている OpenClaw runbook の rotating heartbeat 例に合わせたものです。 ([GitHub][4])

## 5.2 実行対象の判定

各チェックには cadence を持たせる。
例として、messages は 30 分、calendar は 2 時間、git は 24 時間のように設定する。

判定式は次の通りとする。

* `lastChecks[checkName]` が `null` なら実行する
* `now - lastChecks[checkName] >= cadenceMs` なら実行する
* それ以外は今回の heartbeat では実行しない

これは heartbeat 全体を止める条件ではなく、その個別チェックを今回省く条件である。heartbeat 自体は別途 30 分ごとに起動する。OpenClaw の設計でも、heartbeat は周期的な main session turn として動き、複数の periodic checks をまとめる用途とされている。 ([OpenClaw][2])

## 5.3 重複通知の防止

同じ通知を何回も出さない判定は、**モデルの出力文字列の一致** ではなく、**元データの安定キー** を使って行う。

安定キーの例:

* メッセージ: `message:<messageId>`
* 予定: `calendar:<eventId>:2h-warning`
* タスク: `task:<taskId>:blocked`

通知前に `lastNotified[key]` を見て、再通知禁止時間を超えていない場合は通知しない。
OpenClaw の公開例では、前回 timestamp と「new event since last check」のような条件で回しており、通知文の文字列比較や、通知文をもう一度モデルに渡して意味比較する仕様は確認できない。 ([GitHub][4])

## 5.4 時間帯制御

必要なら heartbeat または各チェックに active hours を持たせてよい。
OpenClaw には heartbeat の activeHours があり、タイムゾーン設定によって実行可否が変わる。クローンでも同様に、ユーザー時間帯を基準に実行窓を設けてよい。 ([OpenClaw][3])

---

# 6. エラー時の扱い

`heartbeat_state.json` が壊れていて読めない場合、アプリケーションは次のどちらかで処理する。

* 初期値で再生成する
* 壊れたファイルを退避して初期値を作る

このとき、heartbeat は失敗で止めず、可能なら安全側で継続する。
ただし再通知が一時的に増える可能性はあるので、ログに警告を残す。

---

# 7. 互換性に関する注記

OpenClaw の公開資料では、state file の名前は `heartbeat-state.json` とハイフンで書かれる例がある。一方で、ここではユーザー指定に合わせて `heartbeat_state.json` とした。クローン実装ではどちらでもよいが、OpenClaw 風に寄せるならハイフン名の方が近い。 ([GitHub][4])

---

# 8. 実装時の推奨事項

最後に、仕様書には入れても入れなくてもよいですが、実装としてはこれを勧めます。

* `HEARTBEAT.md` は短く保つ
* `heartbeat_state.json` の時刻単位は最初に固定する
* 再通知判定は LLM の文面ではなく元データ ID で行う
* 正確な時刻が必要な仕事は heartbeat に入れない

この方が、OpenClaw の「定期監視」と「正確な時刻ジョブ」の分け方に合い、実装も安定します。 ([OpenClaw][2])

必要なら次に、これをそのまま社内向けに貼れる **簡潔版の仕様書** に縮めます。

[1]: https://docs.openclaw.ai/start/openclaw "Personal Assistant Setup - OpenClaw"
[2]: https://docs.openclaw.ai/automation/cron-vs-heartbeat "Cron vs Heartbeat - OpenClaw"
[3]: https://docs.openclaw.ai/gateway/heartbeat "Heartbeat - OpenClaw"
[4]: https://github.com/digitalknk/openclaw-runbook/blob/main/examples/heartbeat-example.md "openclaw-runbook/examples/heartbeat-example.md at main · digitalknk/openclaw-runbook · GitHub"
[5]: https://docs.openclaw.ai/reference/templates/AGENTS "AGENTS.md Template - OpenClaw"
