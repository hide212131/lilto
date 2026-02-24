## Why

現状は `agent-browser` のみが組み込みスキルとして提供されており、セッション中に得た手順を「再利用可能なスキルとして残す」要求に即応できない。`skill-creator` を組み込みで提供し、スキル化依頼時に優先的に使えるようにして、次回以降の再現性を高める。

## What Changes

- 組み込みスキルとして `skill-creator` を同梱し、起動時のスキル一覧に含める
- ユーザーが「スキルにして」「再利用できるようにして」等を依頼した際、`skill-creator` を優先選択する判定ロジックを追加する
- 生成されたスキルの保存先を `~/.pi/skills/<skill-name>` に統一し、次回セッションでも再利用できる永続化ルールを明確化する
- 組み込みスキルの配置先を `<app data>/skills/bundled/<skill-name>` に整理し、ユーザー生成スキルと分離する

## Capabilities

### New Capabilities
- `skill-authoring-assistant`: スキル化依頼時に `skill-creator` を優先選択し、再利用可能なスキル作成フローを提供する
- `bundled-skill-creator`: `skill-creator` を組み込みスキルとして配布し、アプリ専用スキルディレクトリへ配置する

### Modified Capabilities
- `skill-bundle-discovery`: 組み込み追加された `skill-creator` が通常のスキル探索・一覧化対象になることを requirement に反映する

## Impact

- `src/main/skill-runtime.ts`（組み込み/ユーザー生成スキルの配置処理、一覧化対象）
- `src/main/agent-sdk.ts` と関連判定ロジック（スキル化依頼時の優先選択）
- 組み込みスキル資産の配置（`skill-creator` の同梱元と配布先）
- ユーザー生成スキル配置（`~/.pi/skills`）と Pi 設定（`skills` 配列）の運用
- OpenSpec（`skill-bundle-discovery` の delta と新規 capability specs）
