# lit-chat-app Specification

## Purpose
TBD - created by archiving change migrate-ui-to-lit. Update Purpose after archive.
## Requirements
### Requirement: ルートコンポーネント lilt-app による状態管理
システムは、`<lilt-app>` コンポーネントが `authState`・`providerSettings`・`messages`・`isSending` をリアクティブプロパティとして保持し、子コンポーネントへ属性またはカスタムイベントで伝達しなければならない（MUST）。

#### Scenario: 起動時に認証状態と設定が読み込まれる
- **WHEN** `<lilt-app>` が DOM に接続される（`connectedCallback`）
- **THEN** `window.lilto.getAuthState()` と `window.lilto.getProviderSettings()` が呼ばれ、結果が各リアクティブプロパティに反映される

#### Scenario: 認証状態変化がリアルタイムで反映される
- **WHEN** `window.lilto.onAuthStateChanged` リスナーが呼ばれる
- **THEN** `authState` プロパティが更新され、UI に自動反映される

### Requirement: lilt-top-bar コンポーネント
システムは、トップバーを `<lilt-top-bar>` コンポーネントとして実装し、アプリ名・ステータス表示・設定ボタンを含まなければならない（MUST）。

#### Scenario: ステータスが送信状態に応じて変わる
- **WHEN** `isSending` が `true` の状態で `<lilt-top-bar>` が描画される
- **THEN** ステータス表示が「送信中...」になる

#### Scenario: 設定ボタンクリックでイベントが発火する
- **WHEN** ユーザーが設定ボタン（⚙）をクリックする
- **THEN** `open-settings` カスタムイベントが発火する

### Requirement: lilt-message-list コンポーネント
システムは、メッセージ履歴を `<lilt-message-list>` コンポーネントとして実装し、`messages` プロパティを受け取ってバブル形式で描画しなければならない（MUST）。新しいメッセージ追加時には最下部へ自動スクロールしなければならない（MUST）。

#### Scenario: メッセージ一覧が role に応じてスタイルされる
- **WHEN** `messages` に user / assistant / system / error の各 role のメッセージが含まれる
- **THEN** 各メッセージが対応するスタイル（背景色・配置）で描画される

#### Scenario: 新規メッセージで自動スクロールする
- **WHEN** `messages` プロパティに新しいメッセージが追加される
- **THEN** メッセージリストの表示が最下部にスクロールされる

### Requirement: lilt-composer コンポーネント
システムは、テキスト入力と送信ボタンを `<lilt-composer>` コンポーネントとして実装し、送信時に `send-message` カスタムイベントを発火しなければならない（MUST）。`disabled` プロパティが `true` の場合は送信操作を無効化しなければならない（MUST）。

#### Scenario: Enter（Cmd/Ctrl+Enter）で送信イベントが発火する
- **WHEN** ユーザーが textarea で Cmd+Enter または Ctrl+Enter を押す
- **THEN** `send-message` カスタムイベントが入力テキストをペイロードに発火する

#### Scenario: disabled 時に送信できない
- **WHEN** `disabled` プロパティが `true` の状態でユーザーが送信を試みる
- **THEN** ボタンは `disabled` 状態でありイベントは発火しない

### Requirement: lilt-settings-modal コンポーネント
システムは、設定モーダルを `<lilt-settings-modal>` コンポーネントとして実装し、Claude OAuth フローと Custom Provider 設定 UI を含まなければならない（MUST）。`open` プロパティで表示/非表示を切り替えなければならない（MUST）。

#### Scenario: open プロパティで表示状態が切り替わる
- **WHEN** `open` プロパティが `true` に変わる
- **THEN** モーダルが画面に表示される
- **WHEN** `open` プロパティが `false` に変わる
- **THEN** モーダルが非表示になる

#### Scenario: 設定保存後にイベントが発火する
- **WHEN** Custom Provider の「Save」ボタンをクリックし保存が成功する
- **THEN** `provider-settings-changed` カスタムイベントが発火する

#### Scenario: Claude OAuth 認証完了でモーダルが閉じる
- **WHEN** Claude OAuth 認証フローが完了し `authenticated` 状態になる
- **THEN** `close-settings` カスタムイベントが発火する

### Requirement: index.html の最小化
システムの `src/renderer/index.html` は、`<lilt-app>` カスタム要素の差し込みとバンドル JS の読み込みのみを含む最小シェルでなければならない（MUST）。インライン CSS・インライン HTML 構造を含んではならない（MUST NOT）。

#### Scenario: index.html が最小シェルになっている
- **WHEN** `src/renderer/index.html` の内容を確認する
- **THEN** `<lilt-app>` タグとスクリプト参照以外に実質的な UI 構造が含まれていない

### Requirement: ループ進行ステータス表示
システムは、`lilt-app` が受信したループイベントに基づき、チャット UI 内に実行中ステータスを表示しなければならない（MUST）。この表示は通常のメッセージ履歴と分離して管理しなければならない（MUST）。

#### Scenario: 実行中にステータス領域が表示される
- **WHEN** 進行中イベントを受信している間
- **THEN** チャット UI に実行中ステータス領域が表示される

#### Scenario: 終端通知でステータス領域が消える
- **WHEN** 実行の終端通知を受信する
- **THEN** 実行中ステータス領域が非表示になる

### Requirement: 実行中ツールの視覚化
システムは、実行中ツール一覧を描画し、ユーザーが現在どのツールが動作中かを識別できるようにしなければならない（MUST）。

#### Scenario: 複数ツールが並行で表示される
- **WHEN** 複数の `tool_execution_start` が連続して受信される
- **THEN** UI は全ての実行中ツールを一覧表示する

#### Scenario: ツール終了で一覧が更新される
- **WHEN** 一部ツールの `tool_execution_end` を受信する
- **THEN** 対応ツールのみ一覧から消え、他の進行中ツール表示は維持される

