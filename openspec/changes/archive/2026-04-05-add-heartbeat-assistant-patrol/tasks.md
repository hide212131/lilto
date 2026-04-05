## 1. OpenClaw 互換寄りの runtime/state へ作り替える

- [x] 1.1 heartbeat state を `heartbeat_state.json` 互換の構造へ移行し、旧 `heartbeat-assistant-state.json` を互換読込できるようにする
- [x] 1.2 background patrol prompt を stable key / check name を返せる形式へ更新し、duplicate suppression を stable key 優先へ切り替える
- [x] 1.3 `HEARTBEAT_OK` と duplicate suppression を user-facing session / 通知へ流さず、actionable finding だけを既存の通知経路へ載せる

## 2. Settings / renderer / docs を新契約へ揃える

- [x] 2.1 heartbeat assistant の説明文と状態表示を「問題がある時だけ表面化する」契約へ更新する
- [x] 2.2 `HEARTBEAT.md` ガイドと manual test を OpenClaw 互換寄りの state / silent OK 方針へ更新する

## 3. テストと検証

- [x] 3.1 heartbeat assistant のテストを state migration、silent `HEARTBEAT_OK`、stable key suppression に合わせて更新する
- [x] 3.2 heartbeat 周辺の focused test を実行して回帰がないことを確認する