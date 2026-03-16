# Skills / Workspace Policy

- Skill directories:
  - Bundled skills (Codex managed): `<CODEX_HOME>/skills/.system`
  - User-created skills (persistent): `<app userData>/.agents/skills/<skill-name>`
- Bundled skills:
  - `agent-browser` (`SKILL.md` + references/templates)
  - `skill-creator` (`SKILL.md` + references/templates, build 時に GitHub から最新取得)
- Source control policy:
  - `skills/bundled/*` は Git 管理しない
  - `npm run build` 前に `scripts/sync-skill-creator.js` が最新 `skill-creator` を `skills/bundled/skill-creator` に同期する
- Discovery target: 両ディレクトリを探索対象に含める（同名衝突時は user-created を優先）
- List composition policy:
  - user skill は `skills` ライブラリ管理状態を正として一覧化する
  - bundled skill はアプリ管理資産として別枠で列挙し、最終一覧は `user + bundled` で構成する
- Remove policy:
  - user skill の削除は `skills` ライブラリ管理境界に従って実施する
  - bundled skill は削除対象外（アプリ固有資産）
- Runtime integration:
  - `CODEX_HOME` は既定で `~/.codex` を使い、必要な場合のみ環境変数で上書きする
  - `HOME` もアプリ専用 `userData` へスコープし、global skill は `<app userData>/.agents/skills` に閉じ込める
  - skill 一覧は `<app userData>/.agents/skills` と `<CODEX_HOME>/skills/.system` から構成する
- Workspace root: project root (`process.cwd()`)
- Project workspace: project root (`process.cwd()`)

## Execution Model

- Skill directory と実行時 working directory は別物として扱う
- Skill discovery は Codex home 配下の skill directory を対象に行う
- Skill 実行時の working directory は `Project workspace` を使う
- 相対パスの生成物は `SKILL.md` の場所ではなく、実行中の working directory 基準で解決される前提にする
- Skill directory は instruction / template / helper script を置く参照資産として扱い、生成物の保存先としては使わない

## Generated Files Policy

- ユーザーに残す成果物は `Project workspace` 配下へ作成する
- 即席の scratch file や中間生成物は OS の temp directory へ作成する
- `SKILL.md` と同じディレクトリ、bundled skill directory、user skill install directory には一時ファイルや生成物を書き込まない
- helper script や template は、出力先を引数で受け取るか、未指定時は `working directory` または temp を使う前提で設計する
- relative path を使う手順を書く場合も、「skill directory 基準」ではなく「current working directory 基準」であることを明示する

## Authoring Guidance

- Skill からファイルを生成する場合は、どこへ出力するかを instruction に明記する
- 永続成果物は workspace 内の明示パスを使う
- 一時 HTML / JSON / log / archive は temp directory を使い、処理後に削除可能なものとして扱う
- Skill package 自体を自己書き換えする設計は避ける

## Cleanup Policy

- Cleanup runs on app startup.
- Default TTL: 168 hours (7 days).
- Workspaces older than TTL are removed recursively.
- Current project workspace is never removed.
- TTL override: `LILTO_WORKSPACE_TTL_HOURS` environment variable.
