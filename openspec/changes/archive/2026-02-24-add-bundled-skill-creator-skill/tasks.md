## 1. 組み込み/永続スキル配置の実装

- [x] 1.1 `src/main/skill-runtime.ts` の組み込みコピー処理を `agent-browser` + `skill-creator` 対応へ拡張する
- [x] 1.2 組み込み配置先を `<app data>/skills/bundled` に変更し、探索対象に `~/.pi/skills` を追加する
- [x] 1.3 Pi 設定（`~/.pi/settings.json` / `~/.pi/agent/settings.json`）の `skills` 配列へ2ディレクトリを登録する

## 2. スキル化依頼時の選択ロジック追加

- [x] 2.1 `src/main/agent-sdk.ts` に `skill-creator` 優先判定を追加し、`/skill:` 明示指定時は補正しない分岐を維持する
- [x] 2.2 判定キーワード（日本語/英語）を関数化し、既存 `agent-browser` 判定との競合順を定義する

## 3. テストとドキュメント更新

- [x] 3.1 `src/main/skill-runtime.test.ts` に `skill-creator` 同梱、保存先分離、同名優先順のテストを追加する
- [x] 3.2 `src/main/agent-sdk` 関連テストにスキル化依頼時の自動選択テストを追加する
- [x] 3.3 `docs/skills-workspace-policy.md` と必要な実行手順書を最終仕様に合わせて更新する
- [x] 3.4 E2E 実行前に、前回テスト生成スキルを `~/.pi/skills` からクリーンアップする。ただし `SKILL.md` 内に固定マジックワード `[[LILTO_SKILL_E2E_MAGIC]]` が含まれるスキルのみ削除対象にする（他スキルは削除しない）
- [x] 3.5 最終E2Eで以下の一連フローを検証する: 1) 通常対話で情報を取得する 2) 「再現できるようにスキル化して」と指示してスキル生成する（生成スキルには `[[LILTO_SKILL_E2E_MAGIC]]` を埋め込む） 3) 作成スキルを呼び出して 1) の成果が再現取得できることを確認する
