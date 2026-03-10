## ADDED Requirements

### Requirement: 設定画面で Windows 分離実行を切り替えできる
システムは、Windows 環境においてツール実行先を Windows 分離実行に切り替える設定を UI から ON/OFF 可能にしなければならない（MUST）。既存ユーザーの初期値は OFF とし、明示的に ON にした場合のみ分離実行を有効化しなければならない（MUST）。

#### Scenario: ユーザーが設定を ON にする
- **WHEN** Windows の設定画面で「Windows 分離実行でツールを実行する」を ON にして保存する
- **THEN** システムは設定を永続化し、次回以降のツール実行で分離実行経路を選択する

#### Scenario: 既存ユーザーの初期挙動
- **WHEN** 既存ユーザーが更新後初めてアプリを起動する
- **THEN** システムは分離実行設定を OFF として扱い、従来どおりホスト実行を継続する

### Requirement: 分離実行経路で最小限の環境構築を行う
システムは、Windows 分離実行が ON の場合、コマンド実行前に最小限の実行環境構築を実施しなければならない（MUST）。この実行経路は `windows-sandbox-rs` の責務分離（準備・実行・結果回収）を参考にしつつ、最小機能に限定しなければならない（MUST）。

#### Scenario: ON 時の実行
- **WHEN** ツール実行設定が ON の状態で Bash または Write ツールを実行する
- **THEN** システムはホストの通常経路ではなく分離 executor を通してコマンドを実行し、結果を返す

#### Scenario: OFF 時の実行
- **WHEN** ツール実行設定が OFF の状態で Bash または Write ツールを実行する
- **THEN** システムは既存のホスト実行フローをそのまま使用する

### Requirement: 分離実行利用不可時の失敗を明示する
システムは、分離実行が ON でも executor の準備または実行に失敗した場合、実行を安全に中止し、原因が分かるエラーを返さなければならない（MUST）。安全性を優先し、失敗時にホスト実行へ暗黙フォールバックしてはならない（MUST NOT）。

#### Scenario: executor 準備失敗
- **WHEN** 設定は ON だが分離 executor の準備に失敗する
- **THEN** システムは実行を中止し、準備失敗であることが分かるエラーを返す

#### Scenario: executor 実行失敗
- **WHEN** 設定は ON だが分離 executor 内の実行または結果回収に失敗する
- **THEN** システムは失敗ステップ（setup/execute/retrieve）を識別できるエラー情報を返す
