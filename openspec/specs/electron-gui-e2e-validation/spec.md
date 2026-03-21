# electron-gui-e2e-validation Specification

## Purpose
TBD - created by archiving change add-electron-agent-browser-e2e-gate. Update Purpose after archive.
## Requirements
### Requirement: Electron GUI を Playwright 主体で E2E 検証できる
システムは Playwright を主要な UI 操作ドライバとして Electron アプリの主要 GUI フローを E2E 実行できなければならない（MUST）。また、Proxy 必須の擬似ネットワーク条件でも同フローを実行できなければならない（MUST）。

#### Scenario: 最小スモークフローを実行できる
- **WHEN** 開発者が定義済みの Playwright ベース E2E シナリオを実行する
- **THEN** Electron アプリの起動、主要操作、正常終了を自動で検証できる

#### Scenario: 擬似 Proxy 必須条件でフローを実行できる
- **WHEN** 開発者が Proxy 経由でない外部アクセスを拒否する擬似環境で E2E シナリオを実行する
- **THEN** `useProxy` を有効化した実行経路で問い合わせ成功まで自動検証できる

### Requirement: E2E 実行結果を確認可能である
システムは E2E 実行の成功/失敗を判定できるログまたは結果出力を提供しなければならない（MUST）。Proxy 必須条件の検証結果も同一実行で判定できなければならない（MUST）。

#### Scenario: E2E が失敗した場合に判別できる
- **WHEN** GUI 操作のいずれかが期待結果と一致しない
- **THEN** 実行結果から失敗箇所を識別でき、成功扱いにならない

#### Scenario: Proxy 未設定時の失敗を判別できる
- **WHEN** 擬似 Proxy 必須条件で `useProxy` を無効化したシナリオを実行する
- **THEN** 実行結果から Proxy 未設定による失敗を識別できる

### Requirement: Electron 固有 UI は補助ドライバへ切り分けられる
システムは、主要なユーザー操作を Playwright で扱い、Electron 固有 UI に限って補助ドライバへ切り分ける方針を示さなければならない（MUST）。

#### Scenario: Electron 固有 UI に遭遇した場合
- **WHEN** 開発者が `BrowserWindow` 切り替え、ネイティブダイアログ、アプリメニュー、特殊な `webview` 制御などへ遭遇する
- **THEN** 主要フロー全体を作り直さず、その箇所だけ WebdriverIO Electron Service などの補助ドライバへ切り替えられる
