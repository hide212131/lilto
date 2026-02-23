## Why

チャットで「ブラウザを操作して確認してほしい」という依頼に対して、現状は手動操作や曖昧なガイダンスに留まり、再現性のある自動化フローを提示できない。Agent Skills 標準に準拠したスキル読み込みと `agent-browser` の同梱により、ブラウザ操作依頼への即応性を高める。

## What Changes

- Agent Skills 標準（`SKILL.md` + frontmatter）に準拠したスキル読み込みをプロジェクト内で有効化する
- 参照ドキュメント（pi-mono の `skills.md`）の規約に沿ったスキル構造・発見ルールを採用する
- 組み込みスキルとして `agent-browser` を同梱し、ブラウザ操作系依頼で優先利用できるようにする
- スキル一覧提示とオンデマンド読み込みの挙動を明確化する

## Capabilities

### New Capabilities
- `agent-skills`: Agent Skills 標準に合わせてスキル定義の前提（frontmatter、名称規則、説明文、オンデマンド読み込み）と発見ルールを規定する
- `browser-automation-skill`: `agent-browser` スキルを組み込みで提供し、チャットからのブラウザ操作依頼に対して CLI ベースの自動化を実行できる
- `skill-bundle-discovery`: プロジェクト内に同梱されたスキルディレクトリを発見し、`SKILL.md` を読み込める

### Modified Capabilities
- なし（既存 capability の requirement 変更はなし）

## Impact

- スキル読み込み処理（起動時のスキル一覧化、オンデマンド読み込み）
- スキル配置ディレクトリ（組み込みスキルの配置）
- チャット/エージェントのツール選択ロジック（ブラウザ操作依頼時のスキルトリガー）
