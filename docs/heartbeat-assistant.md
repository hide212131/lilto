# Heartbeat Assistant

heartbeat assistant は `HEARTBEAT.md` を巡回手順書として読み、既定では 30 分ごとに background patrol を実行する機能です。問題がない場合は `HEARTBEAT_OK` として静かに終了し、actionable finding があるときだけ既存の通知経路へ流します。Settings から巡回間隔を変更できます。

## 方針

- heartbeat assistant は report-only です
- 送信、削除、購入などの確定操作は自動実行しません
- 問題がなければ `HEARTBEAT_OK` で終了し、user-facing session や通知は増やしません
- 同じ finding は stable key を優先して繰り返し通知しません
- `HEARTBEAT.md` が空なら model 実行自体を行いません
- state は `heartbeat_state.json` へ分離して保存します

## 表面化のされ方

- `HEARTBEAT_OK` や duplicate suppression の結果は表面化しません
- actionable finding があるときだけ、既存の通知経路へ流れます
- 新しい finding があるときだけ、非フォーカス時の OS 通知も併用します

## cron との違い

- cron は「正確な時刻に何かを実行する」ための仕組みです
- heartbeat assistant は「定期的に様子を見て、必要なときだけ知らせる」ための仕組みです
- heartbeat assistant の内部発火には scheduler daemon を使いますが、Settings と UI では通常の schedule 一覧から分離されています
- heartbeat assistant の state は instruction source と分離して `heartbeat_state.json` へ保存されます

## 最小サンプル

```md
# HEARTBEAT

- 未読や期限切れがないかを軽く確認する
- 緊急性がなければ `HEARTBEAT_OK` を返す
- 対応が必要なときだけ、`KEY:` / `CHECK:` / `MESSAGE:` 形式で短く報告する
- 操作は実行しない
```

## 良い事例

```md
# Team heartbeat

毎回次の順で確認する:

1. 今日中の予定で遅延しそうなものがあるか
2. 未読メッセージや mention が溜まっていないか
3. 返信や整理が必要でも、実際の送信や削除はしない

出力ルール:

- 問題なければ `HEARTBEAT_OK`
- 問題があるときだけ、`KEY:` / `CHECK:` / `MESSAGE:` 形式で報告する
- 同じ内容を言い換えて長くしない
```