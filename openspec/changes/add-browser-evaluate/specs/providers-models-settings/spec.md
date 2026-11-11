## MODIFIED Requirements

### Requirement: ブラウザ設定
`ProviderSettings.browserSettings` は `enabled`・`autoOpenOnToolUse`・`evaluateEnabled` を保持しなければならない（SHALL）。既定値は順に true・true・false とする。保存済み設定に項目がなければ既定値を補完し、`browserSettings` 全体または保存要求で省略された新項目の現在値を維持しなければならない（SHALL）。null・配列・非 boolean の項目は保存を拒否しなければならない（SHALL）。

#### Scenario: 権限設定変更の反映
- **WHEN** `enabled` または `evaluateEnabled` を変更して保存する
- **THEN** capability 発行停止・token と lease の失効・実行中断・MCP client 終了を行い、保存後に新しい権限とツール集合を反映する
- **AND** `evaluateEnabled` だけの変更ではセッションデータと skill policy を変更しない
- **AND** evaluate を無効化するとき、evaluate を配送した現在の View は閉じる

#### Scenario: 自動表示のみの変更
- **WHEN** `autoOpenOnToolUse` だけを変更する
- **THEN** 実行中の run を停止しない

#### Scenario: 設定タブ
- **WHEN** ブラウザ設定を表示する
- **THEN** 3 つのトグルを表示し、全体 OFF では後続項目を disabled にして値を維持する
- **AND** ページのオリジン権限、認証済み情報の読み取り・操作、読取専用ではないこと、実行停止とページ閉鎖を説明する
