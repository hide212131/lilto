## ADDED Requirements

### Requirement: Main プロセスは managed installed plugin state を Codex runtime へ反映する
システムは、lilto が管理する app-server 経由の installed plugin state を Codex runtime 起動環境へ反映しなければならない（MUST）。plugin 管理と runtime 起動は同じ managed `HOME` / `CODEX_HOME` を共有し、Codex 本体が install した plugin が次回送信または新規 thread から利用可能でなければならない（MUST）。

#### Scenario: plugin install 後の新規 thread で plugin が利用可能になる
- **WHEN** ユーザーが plugin をインストールした後に新しい会話または新しい thread で問い合わせを送信する
- **THEN** Main は managed install store を読める Codex runtime 環境で処理を開始する

#### Scenario: plugin install 後の次回送信へ反映される
- **WHEN** plugin インストール完了後に runtime refresh が必要になる
- **THEN** Main は session または runtime cache を更新し、再起動なしでも次回送信から plugin 利用可能状態へ遷移させる

#### Scenario: plugin uninstall 後は runtime から利用されない
- **WHEN** ユーザーが plugin を削除した後に問い合わせを送信する
- **THEN** Main は更新済み installed plugin state を使って処理し、削除済み plugin を runtime から参照しない