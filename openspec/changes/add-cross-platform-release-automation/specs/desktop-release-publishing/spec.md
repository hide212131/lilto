## ADDED Requirements

### Requirement: 配布用 release artifact を段階分離して生成できる
システムは、開発用 build とは別に release 用フローを持ち、少なくとも `prepare`、OS 別 `package`、`publish` を独立して実行できなければならない（MUST）。また、macOS 成果物は macOS 環境で生成でき、Windows 成果物は同じ release metadata を使って Windows runner または Windows 実機で生成できなければならない（MUST）。

#### Scenario: macOS で release 候補を準備できる
- **WHEN** 開発者が macOS 環境で release 用の prepare と package を実行する
- **THEN** システムは release metadata を生成し、macOS 向け成果物と publish 用 artifact 一覧を出力する

#### Scenario: Windows 向け package を同じ metadata から生成できる
- **WHEN** Windows runner または Windows 実機で同一バージョンの release metadata を使って package を実行する
- **THEN** システムは Windows 向け成果物を生成し、macOS 側で準備された artifact 一覧へ統合できる

### Requirement: GitHub と GitLab の両方へ同一 artifact セットを公開できる
システムは、同じ release metadata と artifact セットを入力として GitHub Releases と GitLab Releases の両方へ公開できなければならない（MUST）。公開先ごとの差分は認証情報と API 呼び出しに限定し、配布物の内容とバージョンは一致しなければならない（MUST）。

#### Scenario: GitHub と GitLab に同じバージョンの release candidate を公開できる
- **WHEN** 開発者が release publish を実行し、GitHub と GitLab の認証情報が設定されている
- **THEN** システムは GitHub では draft/prerelease、GitLab では candidate リリースとして、同じバージョン番号・同じ artifact 名・同じ release notes を登録する

#### Scenario: 一方の publish 失敗を判別できる
- **WHEN** GitHub または GitLab のいずれかへの publish に失敗する
- **THEN** システムは失敗した公開先を識別できるログを残し、再試行対象を特定できる

### Requirement: Windows 未検証状態を release 状態として明示できる
システムは、Windows 配布物の package は完了していても Win 実機確認が未完了の場合、その release を未確定状態として扱えなければならない（MUST）。また、Win 実機確認後に同じ release を確定状態へ進められなければならない（MUST）。

#### Scenario: Windows 実機確認待ちの draft を保持できる
- **WHEN** macOS で release 候補を作成し、Windows 成果物の実機確認がまだ終わっていない
- **THEN** システムは release を GitHub では draft/prerelease、GitLab では candidate リリースとして保持し、未確認であることを記録する

#### Scenario: Windows 実機確認後に公開状態を更新できる
- **WHEN** Windows 環境で package と起動確認が完了する
- **THEN** システムは既存の release metadata を使って verification 状態を更新し、最終公開へ進める
