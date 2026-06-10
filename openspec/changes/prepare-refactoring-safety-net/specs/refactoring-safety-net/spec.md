# refactoring-safety-net Specification

## Purpose
大規模なリファクタリングを始める前に、高速な回帰確認手段、継続的な品質ゲート、現状のベースライン記録、IPC 契約の安全網を整備する。

## ADDED Requirements

### Requirement: 高速な unit テスト経路
システムは、renderer バンドルを経由せずに main / shared 中心の変更を確認できる `test:unit` 実行経路を提供しなければならない（MUST）。この経路は TypeScript の main 向け build と `node --test` を組み合わせ、既存の `npm test` より短いフィードバックループを提供しなければならない（MUST）。

#### Scenario: renderer を触らない変更で高速確認できる
- **WHEN** 開発者が main または shared のコードだけを変更して回帰確認を行う
- **THEN** システムは renderer バンドルを必須にせず `test:unit` を実行できる

### Requirement: リファクタリング前の CI 品質ゲート
システムは、macOS と Windows の両方で TypeScript 型チェックと unit テストを自動実行する CI workflow を提供しなければならない（MUST）。この workflow は既存のネイティブ build workflow と独立して失敗を報告できなければならない（MUST）。

#### Scenario: pull request で型または unit テストの回帰を止められる
- **WHEN** 変更が CI で検証される
- **THEN** システムは macOS と Windows の両方で型チェックと `test:unit` を実行し、失敗時は change をグリーン扱いにしない

### Requirement: ベースライン計測の保存
システムは、未使用 export、未使用依存、ファイル数、行数、およびリファクタリング効果の比較に必要な基礎指標を記録し、追跡可能な文書として保存しなければならない（MUST）。この記録は後続フェーズで再計測した値と比較できる形式でなければならない（MUST）。

#### Scenario: 後続フェーズで削減効果を比較できる
- **WHEN** 開発者がフェーズ 1 以降でリファクタリング効果を確認したい
- **THEN** システムはフェーズ 0 時点の基礎指標を保存した文書を参照できる

### Requirement: IPC 契約の特性テスト
システムは、main IPC の公開チャネルについて、チャネル名と引数・戻り値の形を固定する特性テストを提供しなければならない（MUST）。これらのテストは、後続の `ipc.ts` 分割で実装構造が変わっても公開契約の互換性を検証できなければならない（MUST）。

#### Scenario: IPC 分割後も公開契約の差分を検知できる
- **WHEN** 開発者が `ipc.ts` の構造を分割または整理した後にテストを実行する
- **THEN** システムはチャネル名または payload 形状の互換性破壊を特性テストで検知する