# refactoring-pruning Specification

## Purpose
未使用コード、重複モジュール、重複依存、重複スキル定義を、挙動を変えずに削減し、後続のリファクタリングをより小さい差分で進められる状態にする。

## ADDED Requirements

### Requirement: ベースライン起点で未使用候補を安全に削除できる
システムは、フェーズ 0 で記録したベースラインを出発点として未使用候補を列挙し、各候補について実参照確認と検証を伴って削除できなければならない（MUST）。機械的な未使用判定だけで削除を確定してはならない（MUST NOT）。

#### Scenario: 未使用候補を削除対象として確定する
- **WHEN** 開発者が knip または depcheck の結果から未使用 export、未使用ファイル、未使用依存の候補を選ぶ
- **THEN** システムは `tasks/refactoring-baseline.md` を根拠として参照でき、削除前に実参照確認を行う前提で候補を扱える

### Requirement: アプリのパス決定点を単一モジュールへ統合する
システムは、アプリ内で利用する user data 系パスの決定を `app-paths.ts` に集約し、重複する path policy モジュールを残さないようにしなければならない（MUST）。この統合は既存の呼び出し側契約を壊してはならない（MUST NOT）。

#### Scenario: user data path を単一モジュールから解決する
- **WHEN** 開発者が main プロセス側で user data path を参照する
- **THEN** システムは `app-paths.ts` を唯一の決定点として使え、重複モジュールへ依存しない

### Requirement: スキル定義は単一の正本から生成される
システムは、スキル定義の編集対象を 1 箇所の正本へ固定し、他の配置先は同期スクリプトから再生成できなければならない（MUST）。生成先の内容を手作業の正本として扱ってはならない（MUST NOT）。

#### Scenario: スキル定義を更新したときに複製先を同期できる
- **WHEN** 開発者が正本のスキル定義を更新して build または同期処理を実行する
- **THEN** システムは `.codex/skills/` と `.github/skills/` の定義を正本から再生成できる

### Requirement: 依存削除後も既存の検証と packaged build を維持する
システムは、未使用依存や不要ファイルを削除した後も、既存テスト経路と packaged build 検証を通じて実行時参照の互換性を確認できなければならない（MUST）。Phase 1 の削減作業は、これらの検証を省略したまま完了としてはならない（MUST NOT）。

#### Scenario: 削除後の回帰を packaged build まで確認する
- **WHEN** 開発者が未使用依存または動的参照の疑いがあるファイルを削除した後に検証する
- **THEN** システムは `npm test` と packaged build 相当の検証で、実行時参照が壊れていないことを確認できる