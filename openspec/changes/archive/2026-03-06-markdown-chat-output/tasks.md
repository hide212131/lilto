## 1. 依存ライブラリの追加

- [x] 1.1 `npm install marked` で Markdown パースライブラリを追加する

## 2. チャット UI の Markdown レンダリング

- [x] 2.1 `src/renderer/components/message-list.ts` に `import { marked } from "marked"` を追加する
- [x] 2.2 `_renderMarkdown` メソッドで `marked.parse(text)` を呼び、結果を `unsafeHTML` でレンダリングする
- [x] 2.3 Markdown 用 CSS スタイル（見出し・リスト・コードブロック・リンク・テーブル・引用・水平線）をコンポーネントの `styles` に追加する

## 3. 外部リンクのセキュアなハンドリング

- [x] 3.1 `src/renderer/components/message-list.ts` に `_handleChatClick` メソッドを追加する（イベントデリゲーションで `<a>` タグを捕捉）
- [x] 3.2 `_handleChatClick` 内で http/https 以外の URL はスキップし、http/https URL のみ `event.preventDefault()` 後に `window.lilto.openExternalUrl` を呼ぶ
- [x] 3.3 `<div class="chat">` に `@click=${this._handleChatClick}` を追加する

## 4. IPC チャネルの追加

- [x] 4.1 `src/main/ipc.ts` で `shell` を Electron から import に追加する
- [x] 4.2 `src/main/ipc.ts` に `app:openExternal` ハンドラを追加する（URL の形式・プロトコルバリデーション → `shell.openExternal` 呼び出し）
- [x] 4.3 `src/preload.ts` に `openExternalUrl: async (url: string) => ipcRenderer.invoke("app:openExternal", { url })` を追加する
- [x] 4.4 `src/renderer/types.ts` の `window.lilto` 型定義に `openExternalUrl` を追加する

## 5. 型・回帰確認

- [x] 5.1 `npx tsc -p tsconfig.json --noEmit` を実行し、型エラーがないことを確認する
- [x] 5.2 `npm run e2e:electron` を実行し、GUI 変更後の E2E 成功と `test/artifacts/electron-e2e.png` 生成を確認する
