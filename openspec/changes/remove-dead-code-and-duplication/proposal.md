## Why

フェーズ 0 で安全網とベースラインは整ったが、リファクタリング対象の母数自体はまだ大きく、未使用コードや重複定義が分割作業のノイズになっている。フェーズ 1 では挙動を変えずに不要物と重複を先に減らし、以降の main / renderer 分割をより小さい差分で進められる状態にする。

## What Changes

- `tasks/refactoring-baseline.md` の knip / depcheck 結果を起点に、未使用 export・未使用ファイル・未使用依存を候補化し、実参照確認とテスト実行を前提に段階的に削除する。
- `user-data-path.ts` に残っている単独利用のパス解決責務を `app-paths.ts` に統合し、パス決定点を一本化する。
- スキル定義の正本を `.claude/skills/` に固定し、`.codex/skills/` と `.github/skills/` は同期スクリプトから生成する運用へ切り替える。
- 生成物であるスキル定義の扱いと Phase 1 の検証手順を README や関連スクリプトへ反映し、パッケージング検証を含む完了条件を明文化する。

## Capabilities

### New Capabilities
- `refactoring-pruning`: 未使用コード・重複定義・重複依存を、挙動を変えずに削減するための削除基準、統合方針、検証条件を定義する

### Modified Capabilities

- なし

## Impact

- `src/main/app-paths.ts`、`src/main/user-data-path.ts`、関連 import 元
- `.claude/skills/`、`.codex/skills/`、`.github/skills/`、`scripts/sync-skill-creator.js` または後継同期スクリプト
- `package.json`、`package-lock.json`、README と build / prebuild 経路
- `tasks/refactoring-baseline.md` を根拠に進める削除候補の確認フロー
- `npm test` と `npm run dist:mac` を含む検証手順