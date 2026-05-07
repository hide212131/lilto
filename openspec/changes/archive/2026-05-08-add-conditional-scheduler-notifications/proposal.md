## Why

現在の scheduler は発火すると常に通知文言を前面に出す前提で動いており、バックエンド処理だけを静かに完了させたいケースでも UI 上の変化が発生します。処理結果に応じて通知要否を切り替えたい要件が増えたため、cron 登録時に通知判断基準を保持し、発火後の実行結果を見て LLM が通知可否を決められるようにする必要があります。

## What Changes

- cron 登録時に、通知判断基準を任意で保持できるようにする
- scheduler 発火時の後続処理を、まずバックエンドで実行し、その実行結果を使って LLM が通知するかどうかを判定できるようにする
- 通知不要と判定された場合は、ユーザー向けチャット通知や OS 通知を出さずに処理を終了できるようにする
- 通知判断基準が指定されていない既存どおりのスケジュールは、毎回通知する既定動作を維持する

## Capabilities

### New Capabilities
- なし

### Modified Capabilities
- `cron-scheduler-tool`: スケジュール登録 payload に通知判断基準を保持し、発火後の通知を条件付きにできるよう要件を拡張する
- `pi-main-agent-runtime`: scheduler 発火後のバックエンド実行結果を LLM 判定へ渡し、通知する場合だけ会話と OS 通知へ反映するよう要件を拡張する

## Impact

- `src/main/cron-tool.ts`、`src/main/scheduler.ts`、`src/main/scheduler-bridge.ts` の schedule payload と実行フロー
- `src/main/agent-sdk.ts`、`src/main/ipc.ts`、`src/renderer/app.ts` の scheduler follow-up と通知反映経路
- scheduler daemon の fired payload、共有 scheduler 型、関連テストと OpenSpec delta specs