## ADDED Requirements

### Requirement: Bash 実行前にポリシー判定できる
システムは、Pi の `bash` tool 呼び出しを実行前に検査し、ポリシー設定に基づいて `deny`、`confirm`、`allow`、`audit` のいずれかを判定しなければならない（MUST）。

#### Scenario: 危険コマンドが拒否される
- **WHEN** `bash` tool の `command` が deny ルールに一致する
- **THEN** システムはコマンド実行をブロックし、一致ルールと理由を返す

#### Scenario: 要確認コマンドが確認待ちになる
- **WHEN** `bash` tool の `command` が confirm ルールに一致する
- **THEN** システムは実行前に利用者確認を要求し、承認時のみ実行を継続する

### Requirement: YAML ポリシー設定でルールを管理できる
システムは、YAML 設定ファイルから Bash ポリシーを読み込み、既定動作、非対話時動作、ルール定義、保護パス、監査ログ設定を解決できなければならない（MUST）。

#### Scenario: YAML から default と rules が読み込まれる
- **WHEN** 有効なポリシー設定ファイルが存在する
- **THEN** システムは `default` と `rules` を読み込み、判定に反映する

#### Scenario: 設定破損時に fail-safe が適用される
- **WHEN** ポリシー設定ファイルの読み込みまたは検証に失敗する
- **THEN** システムは設定済み fail-safe mode に従って `confirm` または `deny` を適用し、設定エラーを観測可能にする

### Requirement: 保護パスを追加判定できる
システムは、コマンド文字列中の対象パスと `protectedPaths` 設定を照合し、保護対象への破壊的操作を deny 判定できなければならない（MUST）。

#### Scenario: `.env` への破壊的操作が拒否される
- **WHEN** コマンドが `.env` または `.env.*` を対象にした削除・上書き操作を含む
- **THEN** システムは protected path ルールとしてコマンド実行を拒否する

#### Scenario: 非保護パスへの読み取り操作は既定ルールへ委ねられる
- **WHEN** コマンドが protected path に一致しない
- **THEN** システムは通常の rule evaluation と default action に従って判定する

### Requirement: 監査ログを JSON Lines で残せる
システムは、Bash policy gate の判定結果を JSON Lines 形式で監査ログへ記録できなければならない（MUST）。少なくとも `deny`、`confirm`、`audit` の判定は記録しなければならない（MUST）。

#### Scenario: 拒否イベントが監査ログへ出力される
- **WHEN** deny 判定によりコマンド実行がブロックされる
- **THEN** システムは時刻、コマンド、判定、ルール ID、実行可否を含むログ行を書き込む

#### Scenario: 確認後の承認結果が監査ログへ出力される
- **WHEN** confirm 判定のコマンドを利用者が承認または拒否する
- **THEN** システムは承認結果を含むログ行を書き込む
