## ADDED Requirements

### Requirement: 外部通信への Proxy 設定適用
システムは、外部ネットワークへ接続するエージェント実行時に、保存済み Proxy 設定を解決して通信経路へ適用しなければならない（MUST）。

#### Scenario: Proxy 設定ありで外部通信が Proxy 経由になる
- **WHEN** `httpProxy` または `httpsProxy` が設定された状態で問い合わせを実行する
- **THEN** Main は外部通信を Proxy 経由で実行する

#### Scenario: NO_PROXY 対象は Proxy 適用を除外する
- **WHEN** 接続先ホストが `noProxy` に含まれる状態で問い合わせを実行する
- **THEN** Main は当該接続先に Proxy を適用しない

## MODIFIED Requirements

### Requirement: 認証済み状態での問い合わせ応答
システムは、現在選択されている provider の準備完了状態で問い合わせを受理し、provider に応じた SDK 実行結果を構造化応答として Renderer に返却しなければならない（MUST）。また、外部通信が必要な provider 実行では Proxy 設定を考慮した経路で処理しなければならない（MUST）。

#### Scenario: Claude が選択され認証済みなら応答テキストが返る
- **WHEN** provider が Claude かつ OAuth 認証済みのユーザーが質問を送信する
- **THEN** Main は Claude 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Custom Provider が選択され設定済みなら応答テキストが返る
- **WHEN** provider が Custom Provider（OpenAI Completions Compatible）で必要設定が完了したユーザーが質問を送信する
- **THEN** Main は Custom Provider 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Proxy 必須環境でも設定済みなら応答テキストが返る
- **WHEN** 実行環境が Proxy 経由でのみ外部接続可能で、必要な Proxy 設定が保存されている
- **THEN** Main は問い合わせを成功させ、応答を `promptResult` として Renderer に返す

### Requirement: 実行失敗時の標準化エラー
システムは、SDK 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。Proxy 経路の接続失敗も同じ標準化エラー形式で返さなければならない（MUST）。

#### Scenario: SDK 失敗が UI で扱える形式になる
- **WHEN** `pi-coding-agent` SDK 呼び出しが例外を返す
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Proxy 接続失敗が標準化エラーになる
- **WHEN** Proxy 接続に失敗して外部通信が確立できない
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す
