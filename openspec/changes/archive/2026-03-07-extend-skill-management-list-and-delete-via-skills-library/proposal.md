## Why

現在の Skill 管理は「インストール」は実装済みだが、`skills` ライブラリ機能を利用した「一覧」「削除」の管理境界が曖昧で、将来の配布・運用時に実装差分と仕様差分の追跡が難しい。既存実装を後付けで文書化しつつ、今後追加する一覧/削除の要件を先に仕様化して、実装計画を明確化する必要がある。

## What Changes

- 現在の Skill 管理機能（インストール、反映タイミング、格納先、検出方式）を OpenSpec artifacts として明文化する。
- `skills` ライブラリを利用した Skill 一覧取得の要件を追加する。
- `skills` ライブラリを利用した Skill 削除の要件を追加する。
- 一覧/削除の UI 連携・エラー通知・OAuth 利用時の動作一貫性を要件に含める。
- 既存の `agent-skills` 要件を、上記変更に合わせて更新する。

## Capabilities

### New Capabilities
- `skills-library-list-and-remove`: `skills` ライブラリベースでの一覧取得/削除フロー、結果反映、エラー処理を定義する。

### Modified Capabilities
- `agent-skills`: インストール偏重の現行要件を拡張し、一覧/削除の要件と反映ルールを追加する。

## Impact

- Affected code:
  - `src/main/skill-runtime.ts`
  - `src/main/ipc.ts`
  - `src/preload.ts`
  - `src/renderer/components/settings-modal.ts`
  - `src/renderer/types.ts`
- Affected tests:
  - `test/skill-runtime.test.js`
  - 必要に応じて IPC/GUI 関連テスト
- Dependencies:
  - `skills` npm package の API/CLI 実行互換
- Runtime/operations:
  - 配布環境（Node 非依存）での実行保証と、Skill 管理操作の可観測性（ログ/エラー文言）
