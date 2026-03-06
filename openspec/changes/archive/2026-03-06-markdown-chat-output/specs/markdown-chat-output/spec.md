# markdown-chat-output Specification

## Purpose
チャットメッセージを Markdown 形式でレンダリングし、リンクをセキュアに外部ブラウザで開く機能の要件を定義します。

## Requirements

### Requirement: チャットメッセージを Markdown でレンダリングできる
システムは、アシスタントおよびユーザーのメッセージを Markdown としてパースし、見出し・リスト・コードブロック・リンク・テーブル・引用などのリッチ書式を UI 上で描画しなければならない（MUST）。

#### Scenario: Markdown を含むメッセージが表示される
- **WHEN** renderer がテキストに Markdown 記法（見出し・リスト・コードブロック等）を含むメッセージを受信する
- **THEN** UI はそのテキストを Markdown としてパースし、対応する HTML 要素でレンダリングする

#### Scenario: Markdown を含まないメッセージが表示される
- **WHEN** renderer がプレーンテキストのメッセージを受信する
- **THEN** UI は従来どおり読みやすいテキストとして表示する

### Requirement: Markdown 内リンクを外部ブラウザでセキュアに開ける
システムは、チャット内の Markdown リンクをクリックしたとき、Electron のデフォルトナビゲーションを抑制し、http/https URL のみを OS 標準の外部ブラウザで開かなければならない（MUST）。

#### Scenario: http/https リンクをクリックした場合
- **WHEN** ユーザーがチャット内の `http://` または `https://` スキームのリンクをクリックする
- **THEN** Electron 内部ではナビゲーションは発生せず、OS 標準のブラウザで該当 URL が開かれる

#### Scenario: http/https 以外のスキームのリンクをクリックした場合
- **WHEN** ユーザーが `file://` や `javascript:` など http/https 以外のスキームのリンクをクリックする
- **THEN** システムはその URL を無視し、外部ブラウザも Electron ナビゲーションも発生しない

### Requirement: 外部 URL オープンは IPC チャネルを経由してバリデーションされる
システムは、外部 URL を開くリクエストを `app:openExternal` IPC チャネル経由でメインプロセスに伝達し、メインプロセスは URL のバリデーション（形式・プロトコル）を行ってから `shell.openExternal` を呼び出さなければならない（MUST）。

#### Scenario: 正常な http/https URL を受け取った場合
- **WHEN** メインプロセスが `app:openExternal` で有効な http/https URL を受け取る
- **THEN** `shell.openExternal` でその URL を開き、`{ ok: true }` を返す

#### Scenario: 不正な URL を受け取った場合
- **WHEN** メインプロセスが `app:openExternal` で形式不正な URL や http/https 以外のプロトコルを受け取る
- **THEN** `shell.openExternal` は呼ばれず、エラーコードを含む `{ ok: false, error: { code, message } }` を返す
