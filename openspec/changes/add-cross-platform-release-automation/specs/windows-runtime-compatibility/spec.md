## MODIFIED Requirements

### Requirement: 互換性検証の完了条件
システムは、Windows 環境で `new change`、`status`、`instructions` の最小 OpenSpec フローを成功させることを互換性の完了条件として扱わなければならない（MUST）。さらに、Windows 向け配布物については「artifact 生成準備」「Windows 環境での package 成功」「Win 実機での起動確認」を段階的完了条件として記録し、未完了項目を引き継げなければならない（MUST）。

#### Scenario: apply 前フローが Windows で完了する
- **WHEN** ユーザーが Windows で change 作成から最初の artifact 指示取得までを実行する
- **THEN** すべてのコマンドが成功し、ready artifact を取得できる

#### Scenario: macOS から Windows 検証へ作業を引き継げる
- **WHEN** 開発者が macOS 上で Windows 向け配布物の metadata と共通 assets を準備し、作業ブランチを Windows 環境へ渡す
- **THEN** Windows 側の開発者は未完了の検証項目を確認し、その続きから package と確認作業を開始できる

#### Scenario: Windows 配布物の完了状態を段階管理できる
- **WHEN** Windows 向け package は成功したが Win 実機での起動確認がまだ終わっていない
- **THEN** システムはその状態を未完了として記録し、最終公開条件を満たした扱いにしない
