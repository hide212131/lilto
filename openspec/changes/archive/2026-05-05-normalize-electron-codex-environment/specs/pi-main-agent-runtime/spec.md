## MODIFIED Requirements

### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で OpenAI Codex TypeScript SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、Codex SDK 初期化時には Electron 親プロセスの生 `process.env` をそのまま使うのではなく、Codex 実行向けに正規化・補完した environment を `new Codex({ env })` へ渡さなければならない（MUST）。Windows では `PATH` を含む標準環境変数を persistent な User/Machine 環境から補完できなければならず（MUST）、補完後も `CODEX_HOME`、packaged Codex binary path、bridge 用 env など lilto 管理 override が優先されなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、Codex thread 起動時に `workspace-write` を選択し、Codex config override として `windows.sandbox` を渡して Windows sandbox backend が選択可能な起動条件を満たさなければならない（MUST）。

#### Scenario: Main で Codex SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は OpenAI Codex TypeScript SDK を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要なローカルコマンド実行を行う
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

#### Scenario: Electron 起動時でも Codex 用 environment が正規化される
- **WHEN** Electron が Explorer など対話 shell 外の起動元から開始され、`process.env` の `PATH` や標準環境変数が対話 shell と一致しない可能性がある
- **THEN** Main は Codex 起動前に environment を正規化し、補完済みの `PATH` と必要な標準変数を `new Codex({ env })` へ渡す

#### Scenario: environment 補完失敗時は既存経路へフォールバックする
- **WHEN** Windows の persistent environment 解決に失敗する
- **THEN** Main は失敗をログへ残しつつ、既存の `process.env` ベース環境と明示 override を使って Codex 起動を継続する

#### Scenario: Windows sandbox 有効時は workspace-write で起動する
- **WHEN** Windows 上で保存済み Windows sandbox モードが `unelevated` または `elevated` である
- **THEN** Main は Codex thread を `workspace-write` で開始し、`windows.sandbox` 設定を Codex へ渡す

### Requirement: Main プロセスは managed installed plugin state を Codex runtime へ反映する
システムは、lilto が管理する app-server 経由の installed plugin state を Codex runtime 起動環境へ反映しなければならない（MUST）。plugin 管理と runtime 起動は、強制的に同じ `HOME` を共有するのではなく、同じ app-managed `CODEX_HOME` と正規化済み runtime environment を共有しなければならない（MUST）。Codex 本体が install した plugin は、次回送信または新規 thread から利用可能でなければならない（MUST）。

#### Scenario: plugin install 後の新規 thread で plugin が利用可能になる
- **WHEN** ユーザーが plugin をインストールした後に新しい会話または新しい thread で問い合わせを送信する
- **THEN** Main は app-managed install store を読める `CODEX_HOME` と正規化済み runtime environment で処理を開始する

#### Scenario: plugin install 後の次回送信へ反映される
- **WHEN** plugin インストール完了後に runtime refresh が必要になる
- **THEN** Main は session または runtime cache を更新し、再起動なしでも次回送信から plugin 利用可能状態へ遷移させる

#### Scenario: plugin uninstall 後は runtime から利用されない
- **WHEN** ユーザーが plugin を削除した後に問い合わせを送信する
- **THEN** Main は更新済み installed plugin state を使って処理し、削除済み plugin を runtime から参照しない