## ADDED Requirements

### Requirement: ブラウザ設定
`ProviderSettings.browserSettings`（`enabled`、`autoOpenOnToolUse`、既定はともに true）を保持しなければならない（SHALL）。保存済み設定に項目がなければ既定値を補完し、`browserSettings` を省略した保存は現在値を維持しなければならない。null・配列・非 boolean の項目は保存を拒否する。

#### Scenario: enabled 変更の反映
- **WHEN** `enabled` を変更して保存する
- **THEN** capability 発行停止・lease 失効・実行中断とクライアント終了・session cache 破棄・skill policy 同期・保存・Controller 移行の順で反映する。`autoOpenOnToolUse` のみの変更では実行を中断しない

#### Scenario: 設定タブ
- **WHEN** 設定画面を開く
- **THEN**「ブラウザ」タブに 2 つのトグルを表示し、後者は前者 OFF で disabled（値は維持）。有効/無効の切替が実行中の AI 処理を停止することを保存ボタン付近に表示する
