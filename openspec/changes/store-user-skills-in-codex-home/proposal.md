## Why

現在の user skill 追加先は workspace 配下の `.agents/skills` であり、Codex が標準的に参照する `%CODEX_HOME%/skills` とずれている。
`HOME` / `USERPROFILE` を動かさずに skills を確実に認識させるには、アプリから追加・削除する user skills を `%CODEX_HOME%/skills` 配下へ集約する必要がある。

## What Changes

- Skill の追加先を workspace `.agents/skills` から `%CODEX_HOME%/skills` 配下へ変更する。
- Skill の削除、一覧、更新確認も同じ `%CODEX_HOME%/skills` 配下を user skill root として扱う。
- bundled/system skills は既存どおり `%CODEX_HOME%/skills/.system` に配置し、user skill 操作では削除対象外にする。
- workspace `.agents/skills` は新規追加先として使わない。既存データの扱いは design/tasks で移行または互換読込方針を定義する。
- `HOME` / `USERPROFILE` は引き続き変更せず、保存先は `CODEX_HOME` と明示的な `userSkillsDir` で渡す。

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-skills`: user skill の追加・削除・一覧・更新確認で使う保存先を `%CODEX_HOME%/skills` 配下へ変更する。

## Impact

- 影響範囲: `src/main/skill-runtime.ts`, `src/main/ipc.ts`, `src/main/index.ts`, skill runtime 関連テスト
- 既存 user skill データ: 旧 workspace `.agents/skills` に存在する skill をどう扱うか、実装時に移行または読み取り互換を固定する。
- 環境境界: `HOME` / `USERPROFILE` は変更しない。`CODEX_HOME` を app-managed Codex root として使う。
