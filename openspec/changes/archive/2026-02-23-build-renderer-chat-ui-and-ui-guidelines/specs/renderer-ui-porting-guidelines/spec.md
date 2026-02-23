## ADDED Requirements

### Requirement: UI 構成の準拠方針
システムは、Renderer UI 構成を `pi-web-ui` および `pi-web-ui-example` の責務分割に準拠させ、流用部分と変更部分を明示しなければならない（MUST）。また、方針文書には「今回ポーティングするもの」「今回ポーティングしないもの」「Main 側へ移管するもの」を区別して記載しなければならない（MUST）。

#### Scenario: 方針文書で流用と変更が識別できる
- **WHEN** 開発者が UI 方針文書を確認する
- **THEN** 文書にポーティング元から流用する構成要素と Electron 向けに変更する構成要素が区別されて記載されている

### Requirement: Renderer 非対応依存の Main 移管基準
システムは、ファイル I/O 等 Renderer で扱えない依存を含む処理を Main 側へ移管する判断基準を定義しなければならない（MUST）。

#### Scenario: 処理配置の判断が一貫する
- **WHEN** 新しい UI 機能がファイルアクセスや OS 依存 API を必要とする
- **THEN** 方針に従ってその処理は Main 側へ配置され、Renderer は IPC 経由で利用する

### Requirement: docs への方針反映
システムは、確定した UI ポーティング方針を `docs/` 配下の専用ドキュメントに反映し、実装時の参照基準として維持しなければならない（MUST）。

#### Scenario: docs から実装判断基準を参照できる
- **WHEN** 開発者が新規 UI 実装時に `docs/` の方針文書を参照する
- **THEN** 文書に責務境界、流用範囲、変更対象の要点が明記されている
