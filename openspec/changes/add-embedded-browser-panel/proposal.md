## Why

リンク先は全面オーバーレイで表示され、チャットと並べて見られない。AI のブラウザ操作は同梱 `agent-browser`（外部 Chromium）経由で、ユーザーが見ているページと AI が操作するページが別物になる。右サイドパネルの内蔵ブラウザを 1 面だけ持ち、ユーザーと AI が同じページを共有できるようにする（Issue #36）。

## What Changes

- 右側の開閉・リサイズ可能なパネルに、Main 管理の共有 1 面 `WebContentsView` を表示する。
- ツールバー（戻る・進む・再読込・アドレス・外部で開く・閉じる・手動操作切替）を Lit コンポーネントで提供する。
- 旧リンクオーバーレイ（ツールバー View・`lilto.invalid` 疑似 URL）を廃止し、右パネルへ一本化する。
- 専用 stdio MCP（`lilto_browser`）→ localhost HTTP Bridge → Controller の経路で、Codex がページ遷移・DOM 観察・操作・画像取得を行えるようにする。
- 会話単位の所有権（lease）と、実行ごとの capability token を導入する。
- 設定に `browserSettings`（連携の有効/無効、ツール使用時の自動表示）を追加し、OFF 時は進行中の実行を停止する。
- ON の間は同梱 `agent-browser` skill を無効化し、内蔵ブラウザを優先する。

## Capabilities

### New Capabilities

- `embedded-browser-panel`: 右パネル、View の bounds 同期、ツールバー、所有権の表示、リンク捕捉。
- `embedded-browser-agent-tools`: MCP 契約、Bridge、snapshot/ref、入力操作、キャンセル。

### Modified Capabilities

- `browser-automation-skill`: ON は内蔵 MCP 優先、OFF は既存経路。
- `desktop-shell`: リンク表示と右パネル。
- `providers-models-settings`: ブラウザ設定。
- `skill-bundle-discovery`: 条件付き無効化。

## Impact

- Main: Controller、page runtime、Bridge、MCP server、IPC、link-navigation、agent-sdk、skill policy。
- Renderer/preload/shared: 右パネル、bounds 計測、設定タブ、ブラウザ限定 API。
- 配布: `asarUnpack` へ browser MCP と依存資産、配布検証スクリプト。

## Non-goals

タブ・複数ページ面、Playwright／`agent-browser` 互換、任意 JavaScript／selector／CDP の公開、iframe 内操作、ファイル up/download の MCP 操作、拡張・DevTools、再起動後のログイン/履歴復元、認証の `openExternal` の変更。
