## ADDED Requirements

### Requirement: Windows 分離実行を設定で切り替えられる

システムは、Windows 環境において Bash / Edit / Write 系ツールの実行経路を設定で切り替えられなければならない（MUST）。既定値は OFF とし、ON の場合のみ分離実行経路を利用しなければならない（MUST）。

#### Scenario: ユーザーが設定を ON にする

- **WHEN** Windows の設定画面で Windows 分離実行を ON にして保存する
- **THEN** システムは設定を永続化し、次回以降のツール実行で `windows-isolated` モードを選択する

#### Scenario: 既定値または OFF のまま使う

- **WHEN** 分離実行設定が未設定または OFF のままアプリを使う
- **THEN** システムはホスト実行を継続する

### Requirement: 分離実行時は Pi Extensions で built-in tool を override する

システムは、Windows 分離実行が ON の場合、Pi SDK の Extensions 機構を通じて `bash` / `edit` / `write` の built-in tool を override しなければならない（MUST）。Main プロセスが `tools` 配列を直接差し替えるだけの構成に依存してはならない（MUST NOT）。

#### Scenario: ON 時の tool override

- **WHEN** Windows 分離実行が ON の状態で Bash / Edit / Write を実行する
- **THEN** システムは inline extension を含む `resourceLoader` を Pi SDK セッションへ渡し、その override 済みツールを使って実行する

#### Scenario: OFF 時の通常実行

- **WHEN** Windows 分離実行が OFF の状態で Bash / Edit / Write を実行する
- **THEN** システムは Pi の通常の built-in tool 実装を使う

### Requirement: 分離実行アダプタは最小責務で結果を返す

システムは、Windows 分離実行 ON 時の実処理を最小アダプタへ集約しなければならない（MUST）。このアダプタは `windows-sandbox-rs` の責務分離を参考にしつつ、少なくとも setup / execute / retrieve / cleanup を扱えなければならない（MUST）。

#### Scenario: executor が正常終了する

- **WHEN** override された tool が `WindowsIsolatedExecutor` を通じて処理を完了する
- **THEN** システムは実行結果をツール結果として返す

#### Scenario: executor の準備または実行に失敗する

- **WHEN** 分離実行アダプタの setup / execute / retrieve のいずれかが失敗する
- **THEN** システムは失敗ステージを含む明示エラーを返し、ホスト実行へ暗黙フォールバックしない
