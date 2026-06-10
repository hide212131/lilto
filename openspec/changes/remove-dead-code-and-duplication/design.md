## Context

フェーズ 0 で `test:unit`、CI、ベースライン計測、IPC 契約テストが整い、構造変更を安全に進める前提はできた。一方で、現行コードベースには knip / depcheck が指摘した未使用候補、単独利用のパス解決モジュール、3 箇所へ手作業で複製されているスキル定義、未使用 npm 依存が残っており、以降の分割フェーズで探索コストとレビュー差分を増やす要因になっている。

フェーズ 1 の制約は、挙動を変えずに母数だけを減らすことである。特に Electron の preload、asarUnpack 対象、MCP サーバ、ビルドスクリプトは静的解析だけでは参照を見落としうるため、削除判断は機械検出だけで完結させず、grep と実行検証を組み合わせる必要がある。

## Goals / Non-Goals

**Goals:**
- `tasks/refactoring-baseline.md` を起点に、削除候補を実参照確認つきで絞り込み、未使用コードと未使用依存を安全に減らす。
- `user-data-path.ts` の責務を `app-paths.ts` に統合し、アプリ内のパス決定点を 1 箇所に寄せる。
- スキル定義の正本を `.claude/skills/` に固定し、他ディレクトリへの複製を生成フローへ置き換える。
- Phase 1 完了時に `npm test` と packaged build 系検証で、削除や統合が実行時参照を壊していないことを確認できる状態にする。

**Non-Goals:**
- main / renderer の God ファイル分割に着手すること。
- スケジューラー既知バグや機能追加を同時に修正すること。
- OpenSpec アーカイブ全体の整理を必須作業として完了すること。
- strict TypeScript 導入やビルド基盤の全面刷新を行うこと。

## Decisions

### 1. 削除対象はベースライン起点で管理し、実参照確認を必須にする

Phase 0 で保存した `tasks/refactoring-baseline.md` を削除候補の出発点とし、各候補について `grep` で静的参照を確認したうえで削除する。Electron / packaging / dynamic require を含むコードベースでは、knip と depcheck の結果をそのまま削除リストとみなすと誤判定を取り込みやすいためである。

代替として一括削除後に壊れた箇所だけ戻す運用もあるが、Phase 1 の目的はレビュー可能な小差分で母数を減らすことであり、削除と復旧を混ぜる進め方は適さない。

### 2. パス解決は `app-paths.ts` を唯一の決定点にする

`user-data-path.ts` は `index.ts` からしか使われておらず、`app-paths.ts` と並存すると path policy の所在が分散する。そこで `userData` 周りの決定ロジックを `app-paths.ts` へ統合し、呼び出し側は 1 モジュールだけを参照する構成にする。

代替として両モジュールを残したまま責務だけ文書化する方法もあるが、後続フェーズの整理対象を増やすだけで効果が薄い。

### 3. スキル定義は `.claude/skills/` を正本とし、他コピーは生成物にする

`.claude/skills/`、`.codex/skills/`、`.github/skills/` に同一スキル定義を手置きで維持すると、片方だけ更新されるドリフトが起きやすい。Phase 1 では `.claude/skills/` を編集対象の正本に固定し、既存の `sync-skill-creator.js` を拡張するか後継スクリプトへ置き換えて、残り 2 系統は prebuild で再生成する。

代替として symlink を使う案もあるが、配布環境や GitHub 上の扱いが不安定になりやすく、クロスプラットフォーム運用の負担が増えるため採用しない。

### 4. 未使用依存の削除は lockfile 更新と packaged build 検証を一体で行う

`package.json` の未使用依存を削除するだけでは、スクリプトや packaging 時にだけ読まれる依存の欠落を見逃しやすい。依存削除時は `package-lock.json` を同期し、少なくとも `npm test` と `npm run dist:mac` 相当の packaged build 検証を同じ change の完了条件に含める。

代替として unit test のみで終えると、asarUnpack や extraResources で使う実行時参照の破壊を検知できない。

## Risks / Trade-offs

- [Risk] 動的参照が未使用扱いされ、必要ファイルを削除してしまう
  Mitigation: 各候補を個別に grep し、削除後は `npm test` と packaged build 検証で実行時参照を確認する。
- [Risk] スキル同期スクリプト化で生成物更新漏れが起きる
  Mitigation: prebuild に同期を組み込み、README に「編集は正本のみ」の運用を明記する。
- [Risk] `app-paths.ts` への統合で path policy が暗黙に変わる
  Mitigation: 既存の public contract を維持し、`index.ts` など呼び出し側の import 差し替えに留める。
- [Risk] 未使用依存の削除が CI や packaged build だけで壊れる
  Mitigation: lockfile 更新を必須にし、テストと packaging を Phase 1 の完了条件として同時に確認する。

## Migration Plan

1. `tasks/refactoring-baseline.md` を基に削除候補を 1 件ずつ確認し、未使用 export / ファイル / 依存を小分けで削除する。
2. `user-data-path.ts` のロジックを `app-paths.ts` に移し、呼び出し元を差し替えたうえで旧モジュールを削除する。
3. スキル同期スクリプトを整備し、`.codex/skills/` と `.github/skills/` を生成物に切り替える。
4. README や build フローへ正本と生成物の扱いを反映し、依存削除時は `package-lock.json` を更新する。
5. `npm test` と packaged build を実行し、問題があれば各小差分単位で切り戻せるように進める。

## Open Questions

- 既存の `sync-skill-creator.js` を拡張するか、より汎用な `sync-skills.js` へ置き換えるか。
- `npm run dist:mac` を Phase 1 の各小差分ごとに回すか、削除群と同期化をまとめた節目で回すか。
- `openspec/changes/archive/` の整理をこの change の追記事項に留めるか、完全に別 change として分離するか。