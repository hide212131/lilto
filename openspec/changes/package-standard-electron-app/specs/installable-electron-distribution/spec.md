## ADDED Requirements

### Requirement: インストール可能な配布成果物の生成
システムは、Lilt-o の配布ビルドを単一の標準コマンドで実行できなければならない（MUST）。また、そのコマンドは macOS ではインストール可能な `dmg` を、Windows では標準的な installer 実行ファイルを生成しなければならない（MUST）。

#### Scenario: 配布ビルドが標準コマンドで完結する
- **WHEN** 開発者が定義済みの配布コマンドを実行する
- **THEN** システムは前提 build を含めて packaging を完了し、成果物を `release/` などの決められた出力先へ生成する

#### Scenario: Windows 向け installer を出力できる
- **WHEN** Windows で配布コマンドを実行する
- **THEN** システムはユーザーが通常のインストール手順で導入できる installer 実行ファイルを生成する

### Requirement: 配布済みアプリで native helper を解決できる
システムは、配布済みアプリとして起動した場合でも `scheduler-daemon` および `speech-transcriber` などの native helper を `process.resourcesPath` 配下から解決できなければならない（MUST）。また、開発環境では従来どおり repository 配下の build 出力へフォールバックできなければならない（MUST）。

#### Scenario: packaged resources から scheduler helper を起動できる
- **WHEN** 配布済みアプリが scheduler 機能を初期化する
- **THEN** システムは同梱済み `resources/bin` 配下の scheduler helper を選択して起動する

#### Scenario: packaged resources から speech helper を起動できる
- **WHEN** 配布済みアプリが音声 transcription helper を必要とする
- **THEN** システムは同梱済み `resources/bin` または配布形式に応じた helper path を解決して実行する

#### Scenario: 開発環境では従来の build 出力を利用できる
- **WHEN** 開発環境でアプリを起動する
- **THEN** システムは repository 配下の native build 出力を優先して解決し、packaged path がなくても起動継続できる

### Requirement: 配布 readiness の検証
システムは、配布機能の変更を完了とみなす前に、生成された成果物の存在と主要 native resource の同梱を検証しなければならない（MUST）。

#### Scenario: 配布成果物の存在を確認できる
- **WHEN** 配布コマンドの実行が成功する
- **THEN** システムは想定した installer / disk image の生成を確認できる

#### Scenario: native helper の同梱を確認できる
- **WHEN** 配布成果物の検証を行う
- **THEN** システムは scheduler と speech helper が配布物に含まれていることを確認できる
