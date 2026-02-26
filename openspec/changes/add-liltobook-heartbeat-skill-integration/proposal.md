## Why

長めの会話で得られた再利用可能な手順が、その場限りで失われやすく、継続的な生産性改善につながっていない。目的達成後の定期処理でスキル化候補を自律抽出し、ユーザー確認を経て安全にスキル化できる仕組みを今追加する必要がある。

## What Changes

- 組み込みスキル `liltobook` を追加し、`SKILL.md` と `HEARTBEAT.md` を同梱する。
- `liltobook/HEARTBEAT.md` に、会話履歴から再利用可能な作業を検出したとき `skill-creator` を呼び出してスキル化提案する定期処理方針を定義する。
- 既存の heartbeat 実行処理を拡張し、`pi-coding-agent` に `HEARTBEAT.md` を読ませて実行する。
- スキル化前に必ずユーザー確認を要求し、未承認時は作成しない。
- 既存スキルと重複・類似する候補は抑止し、同等スキルの多重作成を防ぐ。

## Capabilities

### New Capabilities
- `liltobook`: 組み込みスキルとして `SKILL.md`/`HEARTBEAT.md` を持ち、heartbeat で参照される自律改善ポリシーを提供する。

### Modified Capabilities
- `heartbeat-jobs`: heartbeat tick 時に `HEARTBEAT.md` を `pi-coding-agent` 経由で実行する要件へ拡張する。
- `skill-authoring-assistant`: 自律スキル化時のユーザー確認ゲートと重複作成抑止を要件として追加する。

## Impact

- Affected code: Main プロセスの heartbeat オーケストレーション、Pi 実行呼び出し、スキル生成フロー。
- Affected assets: 組み込みスキル配下への `liltobook/SKILL.md` と `liltobook/HEARTBEAT.md` の追加。
- Affected behavior: 目的達成後の定期実行でスキル化提案が発生し、ユーザー承認後のみ永続スキルが生成される。
