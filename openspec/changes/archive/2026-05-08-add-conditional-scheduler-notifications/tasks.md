## 1. 型と登録経路の拡張

- [x] 1.1 `src/shared/scheduler.*` と scheduler daemon payload に `notificationDecisionCriteria` を追加し、既存データを後方互換で読めるようにする
- [x] 1.2 `src/main/cron-tool.ts` と関連 MCP schema を更新し、高水準・低水準の両 operation で通知判断基準を保存できるようにする
- [x] 1.3 cron tool と scheduler service のテストを追加し、判断基準あり・なしの登録結果を検証する

## 2. 発火後のバックエンド実行と通知判定

- [x] 2.1 scheduler 発火イベントの follow-up 実行を visible UI 更新から分離し、非表示で処理結果を取得できる経路を実装する
- [x] 2.2 follow-up 実行結果、通知文言、判断基準を使う通知判定 prompt と構造化 parser を実装し、parse 失敗時は通知へフォールバックさせる
- [x] 2.3 heartbeat internal schedule と通常 schedule を分離したまま、条件付き schedule だけが通知判定フローへ入ることをテストする

## 3. 通知反映と回帰確認

- [x] 3.1 Renderer/Main の通知反映を更新し、`shouldNotify=true` のときだけチャット通知・OS 通知・未読バッジを出すようにする
- [x] 3.2 判断基準なし schedule が従来どおり毎回通知されるケースと、判断基準あり schedule が通知なしで静かに終了するケースの回帰テストを追加する
- [x] 3.3 OpenSpec/manual test に沿って関連テストを実行し、条件付き通知の挙動を検証する