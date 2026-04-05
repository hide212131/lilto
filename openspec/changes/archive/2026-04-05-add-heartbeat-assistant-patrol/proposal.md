## Why

OpenClaw 風の最小デスクトップ AI アシスタントでは、定期的に状況を見回って必要なときだけ静かに知らせる導線が重要になる。既存の cron は正確な時刻実行には向いているが、`HEARTBEAT.md` を読んで軽い巡回を行い、何もなければ `HEARTBEAT_OK` で黙る契約までは表現していないため、heartbeat 概念を維持した専用機能として整理したい。

## What Changes

- `HEARTBEAT.md` を読みながら定期巡回する heartbeat assistant 機能を、OpenClaw 互換寄りの実行モデルへ作り替える。
- heartbeat assistant は内部の定期発火基盤として既存の scheduler daemon を再利用しつつ、ユーザー向けには cron と分離した巡回機能として扱う。
- heartbeat runtime state を `heartbeat_state.json` 互換の構造へ寄せ、`lastChecks`・`lastNotified`・`lastSeen` を中心に扱う。既存の `heartbeat-assistant-state.json` は互換読込対象とする。
- `HEARTBEAT_OK` は user-facing session や通知へ出さず、actionable finding だけを既存の通知経路へ流す。空ファイルの場合も静かに終了する。
- Settings から heartbeat assistant の有効化、参照する `HEARTBEAT.md` の場所、基本設定を管理できるようにする。
- `HEARTBEAT.md` の書き方と `heartbeat_state.json` の役割を docs / spec に反映する。

## Capabilities

### New Capabilities
- `heartbeat-driven-assistant`: `HEARTBEAT.md` を手順書として読み、定期巡回と静かな通知契約を提供する機能を定義する。
- `heartbeat-assistant-settings`: Settings から heartbeat assistant の有効化と設定管理を行う機能を定義する。

### Modified Capabilities
- `pi-main-agent-runtime`: heartbeat assistant が Main プロセス runtime と通知経路を使って巡回結果を扱えるよう、要件を拡張する。

## Impact

- Main プロセスの scheduler 連携、runtime 呼び出し、通知処理。
- provider settings の保存モデル、IPC、preload bridge、Settings UI。
- `HEARTBEAT.md` ガイド、heartbeat state 仕様、手動検証手順、関連 OpenSpec spec。
- heartbeat state の保存先、互換読込、重複通知抑制ロジック。