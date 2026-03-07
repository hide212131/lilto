## MODIFIED Requirements

### Requirement: Skill レジストリへの静的登録
Skill はアプリ起動時にレジストリへ静的登録されなければならない（SHALL）。ただし、SKILL.md ベースのスキルは起動時に一覧化され、実行時にオンデマンドで読み込まれなければならない（SHALL）。また、Skill の追加/削除後は次回送信時に最新状態が反映されるよう、ランタイム状態を再同期しなければならない（SHALL）。

#### Scenario: 登録済み Skill の実行
- **WHEN** AI エージェントが登録済み Skill 名を呼び出す
- **THEN** 対応する Skill の `execute()` が呼び出され、結果が返される

#### Scenario: SKILL.md スキルの一覧化
- **WHEN** 起動時にスキル一覧が作成される
- **THEN** SKILL.md ベースのスキル（symlink 形式を含む）が一覧に含まれる

#### Scenario: オンデマンド読み込み
- **WHEN** SKILL.md ベースのスキルが実行要求される
- **THEN** 実体が読み込まれて実行される

#### Scenario: スキル追加後の反映
- **WHEN** ユーザーが Skill を追加し処理が成功する
- **THEN** 次回のプロンプト送信時に新しい Skill が利用可能になる

#### Scenario: スキル削除後の反映
- **WHEN** ユーザーが user skill を削除し処理が成功する
- **THEN** 次回のプロンプト送信時に削除済み Skill は利用対象から除外される
