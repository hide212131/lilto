## ADDED Requirements

### Requirement: agent-browser の条件付き無効化
ブラウザ連携 ON の間、Lilto 管理ブロックに同梱 `agent-browser/SKILL.md`（およびユーザー領域の同名 skill の発見済み絶対パス）を `enabled = false` で出力しなければならない（SHALL）。OFF 時はこのために加えたエントリを除去し、管理ブロック外の設定を変更してはならない（SHALL NOT）。

#### Scenario: 既存の repository skill 無効化
- **WHEN** policy を再生成する
- **THEN** 現行の repository skill 無効化リストを維持し、重複を除く
