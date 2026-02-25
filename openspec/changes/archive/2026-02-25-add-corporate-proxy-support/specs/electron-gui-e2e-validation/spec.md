## MODIFIED Requirements

### Requirement: Electron GUI を agent-browser で E2E 検証できる
システムは `agent-browser` を利用して Electron アプリの主要 GUI フローを E2E として実行できなければならない（MUST）。また、Proxy 必須の擬似ネットワーク条件でも同フローを実行できなければならない（MUST）。

#### Scenario: 最小スモークフローを実行できる
- **WHEN** 開発者が定義済みの E2E 実行手順で `agent-browser` シナリオを実行する
- **THEN** Electron アプリの起動、主要操作、正常終了を自動で検証できる

#### Scenario: 擬似 Proxy 必須条件でフローを実行できる
- **WHEN** 開発者が Proxy 経由でない外部アクセスを拒否する擬似環境で E2E シナリオを実行する
- **THEN** Proxy 設定を適用した実行経路で問い合わせ成功まで自動検証できる

### Requirement: E2E 実行結果を確認可能である
システムは E2E 実行の成功/失敗を判定できるログまたは結果出力を提供しなければならない（MUST）。Proxy 必須条件の検証結果も同一実行で判定できなければならない（MUST）。

#### Scenario: E2E が失敗した場合に判別できる
- **WHEN** GUI 操作のいずれかが期待結果と一致しない
- **THEN** 実行結果から失敗箇所を識別でき、成功扱いにならない

#### Scenario: Proxy 未設定時の失敗を判別できる
- **WHEN** 擬似 Proxy 必須条件で Proxy 設定を無効化したシナリオを実行する
- **THEN** 実行結果から Proxy 未設定による失敗を識別できる
