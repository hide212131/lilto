## ADDED Requirements

### Requirement: 設定画面で Windows Sandbox 実行を切り替えできる
システムは、Windows 環境においてツール実行先を Windows Sandbox に切り替える設定を UI から ON/OFF 可能にしなければならない（MUST）。既存ユーザーの初期値は OFF とし、明示的に ON にした場合のみ Sandbox 実行を有効化しなければならない（MUST）。

#### Scenario: ユーザーが設定を ON にする
- **WHEN** Windows の設定画面で「Windows Sandbox でツールを実行」を ON にして保存する
- **THEN** システムは設定を永続化し、次回以降のツール実行で Sandbox 経路を選択する

#### Scenario: 既存ユーザーの初期挙動
- **WHEN** 既存ユーザーが更新後初めてアプリを起動する
- **THEN** システムは Sandbox 実行設定を OFF として扱い、従来どおりホスト実行を継続する

### Requirement: Sandbox 実行経路で最小限の環境構築を行う
システムは、Windows Sandbox 実行が ON の場合、コマンド実行前に Sandbox の起動と最小限の実行環境構築を実施しなければならない（MUST）。この実行経路は `windows-sandbox-rs` の責務分離（起動・投入・実行・結果回収）を参考にしつつ、最小機能に限定しなければならない（MUST）。

#### Scenario: ON 時の実行
- **WHEN** ツール実行設定が ON の状態で Bash または Write ツールを実行する
- **THEN** システムはホストではなく Sandbox を起動し、環境構築後にコマンドを実行して結果を返す

#### Scenario: OFF 時の実行
- **WHEN** ツール実行設定が OFF の状態で Bash または Write ツールを実行する
- **THEN** システムは既存のホスト実行フローをそのまま使用する

### Requirement: Sandbox 利用不可時の失敗を明示する
システムは、Sandbox 実行が ON でも Windows Sandbox が利用不可または起動失敗の場合、実行を安全に中止し、原因が分かるエラーを返さなければならない（MUST）。安全性を優先し、利用不可時にホスト実行へ暗黙フォールバックしてはならない（MUST NOT）。

#### Scenario: Windows Sandbox 機能が無効
- **WHEN** 設定は ON だが OS 側で Windows Sandbox 機能が無効になっている
- **THEN** システムは実行を中止し、機能有効化が必要である旨を含むエラーを返す

#### Scenario: Sandbox 起動失敗
- **WHEN** 設定は ON だが Sandbox プロセス起動または初期化に失敗する
- **THEN** システムは失敗ステップ（起動/投入/実行/回収）を識別できるエラー情報を返す
