## Why

現在の lilto では、アシスタントが Markdown 形式のテキスト（見出し・リスト・コードブロック・リンクなど）を返してもプレーンテキストとして表示されるため、可読性が低く情報の構造が失われます。Claude などの LLM は Markdown を多用して回答するため、UI 側でもレンダリングすることでユーザー体験を大幅に向上できます。

また、Markdown 内のリンクをクリックした際に Electron がそのまま内部ナビゲーションするとセキュリティリスクがあるため、外部リンクを安全に OS 標準ブラウザで開く仕組みも同時に整備する必要があります。

## What Changes

- チャットメッセージ（アシスタント・ユーザー）を `marked` ライブラリで Markdown パースし、HTML としてレンダリングする。
- 見出し・リスト・コードブロック・リンク・テーブル・引用などの要素に対応する CSS スタイルをチャット UI に追加する。
- チャット領域のクリックイベントをハンドリングし、`<a>` タグへのクリックを捕捉して http/https のみを外部ブラウザに渡す。
- `app:openExternal` IPC チャネルをメインプロセスに追加し、URL の形式・プロトコルをバリデーションしてから `shell.openExternal` で開く。
- `openExternalUrl` を preload で renderer に公開し、renderer から IPC を呼び出せるようにする。
- 型定義（`src/renderer/types.ts`）に `openExternalUrl` の型を追加する。

## Capabilities

### New Capabilities
- `markdown-chat-output`: チャットメッセージの Markdown レンダリングと外部リンクの安全な処理に関する機能要件を定義する。

### Modified Capabilities
- `renderer-chat-ui`: チャット表示に Markdown レンダリングを追加するため、テキスト表示要件を拡張する。

## Impact

- 影響コード: `src/renderer/components/message-list.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/types.ts`, `package.json`
- IPC/イベント: 新規 `app:openExternal` チャネルを追加（既存チャネルへの影響なし）
- 依存: `marked`（Markdown パースライブラリ）を新規追加
- UX: アシスタント・ユーザーメッセージが Markdown でリッチ表示される
- UX: リンクをクリックすると外部ブラウザが安全に開かれる
- セキュリティ: http/https 以外のプロトコルはブロックされ、Electron 内ナビゲーションは発生しない
