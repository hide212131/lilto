## Context

lilto のチャット UI は `LiltMessageList` コンポーネントで実装されており、メッセージは `unsafeHTML` でそのまま HTML に挿入されています。現状は `marked` などのパーサーを使わず、テキストをエスケープせずに表示していました。

アシスタント（Claude）の回答は Markdown 記法を多用するため、見出しやコードブロックが生テキストとして表示される問題がありました。また、Markdown 内のリンク（`<a>` タグ）がクリックされると Electron が内部ナビゲーションしてしまうセキュリティリスクがありました。

外部 URL は必ずメインプロセスの `shell.openExternal` を経由させ、プロトコルバリデーション後に開くことでセキュリティを担保します。

## Goals / Non-Goals

**Goals:**
- `marked` ライブラリを使ってメッセージテキストを Markdown パースし、HTML としてレンダリングする。
- チャット UI に Markdown 用 CSS を追加し、見出し・リスト・コードブロック等を読みやすく表示する。
- チャット領域のクリックを捕捉し、`<a>` タグの http/https URL のみを `app:openExternal` IPC 経由で外部ブラウザに渡す。
- メインプロセスで URL のバリデーション（形式・プロトコル）を行ってから `shell.openExternal` を呼ぶ。
- preload に `openExternalUrl` を追加して renderer から安全に IPC を呼び出せるようにする。

**Non-Goals:**
- Markdown のサーバーサイドレンダリングやキャッシュ。
- ユーザーによる Markdown レンダリングの ON/OFF 設定。
- リンク先のプレビュー表示。
- ファイルや mailto など http/https 以外のプロトコルのサポート。

## Decisions

1. **`marked` ライブラリを Markdown パーサーとして採用する**
   - 選択: `marked` を `npm install` し、`_renderMarkdown` で `marked.parse(text)` を呼ぶ。
   - 理由: 軽量・高速で、Electron/Lit のエコシステムと互換性が高い。同期 API で実装がシンプル。
   - 代替案: `markdown-it`。
     - 不採用理由: API が複雑で今回の用途には過剰。

2. **クリックハンドラをチャットコンテナ全体に一つ設ける（イベントデリゲーション）**
   - 選択: `<div class="chat">` に `@click=${this._handleChatClick}` を設定し、内部の `<a>` をバブルアップで捕捉する。
   - 理由: Markdown レンダリング後の動的リンクに対して個別にイベント登録する必要がなく実装がシンプル。
   - 代替案: 各リンクに直接 `onclick` を設定。
     - 不採用理由: `unsafeHTML` でレンダリングした要素への後付けイベント登録はコードが複雑になる。

3. **URL バリデーションをメインプロセスで行う**
   - 選択: renderer 側でも http/https フィルタリングを行うが、最終的な検証は `app:openExternal` ハンドラで行う。
   - 理由: renderer は信頼境界外のため、サンドボックス内でのバリデーションだけでは不十分。メインプロセスでも検証することで多重防御になる。
   - 代替案: renderer のみでバリデーション。
     - 不採用理由: renderer が侵害された場合のリスクが残る。

4. **renderer 側でも http/https 以外をフィルタリングして IPC を呼ばない**
   - 選択: `_handleChatClick` で `resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:"` の場合は早期 return する。
   - 理由: 不要な IPC 呼び出しを削減し、レスポンスを高速化する。
   - 代替案: renderer は全 URL を IPC に渡す。
     - 不採用理由: `javascript:` など悪意のある URL が IPC に渡るリスクがある。

## Risks / Trade-offs

- [Risk] `marked.parse` が同期実行で大きなテキストをレンダリングするとメインスレッドをブロックする可能性 → Mitigation: チャットメッセージは通常短いため実用上問題ない。将来的に非同期 API に移行可能。
- [Risk] `unsafeHTML` で Markdown パース後の HTML を挿入するため、XSS リスクがある → Mitigation: `marked` はデフォルトで安全な出力を生成するが、入力がサードパーティコンテンツの場合は sanitizer の追加を検討。現状はモデル出力のみのためリスクは限定的。
- [Risk] http/https リンク以外（`mailto:` 等）がクリックされても何も起きない → Mitigation: 現仕様の意図的な制限であり、ユーザーへの明示は不要（メールアドレスなどは通常テキストとして表示される）。

## Migration Plan

1. `npm install marked` で依存を追加する。
2. `src/renderer/components/message-list.ts` に `import { marked } from "marked"` を追加し、`_renderMarkdown` で `marked.parse(text)` を使用する。
3. `src/renderer/components/message-list.ts` の CSS に Markdown 用スタイル（見出し・リスト・コードブロック・リンク・テーブル・引用・水平線）を追加する。
4. `src/renderer/components/message-list.ts` に `_handleChatClick` メソッドを追加し、http/https リンクのクリックを捕捉して `window.lilto.openExternalUrl` を呼ぶ。
5. `<div class="chat">` に `@click=${this._handleChatClick}` を追加する。
6. `src/main/ipc.ts` に `app:openExternal` ハンドラを追加し、URL バリデーションと `shell.openExternal` 呼び出しを実装する（`shell` を import に追加）。
7. `src/preload.ts` に `openExternalUrl` を追加して IPC ブリッジを公開する。
8. `src/renderer/types.ts` に `openExternalUrl` の型宣言を追加する。
9. 型チェック（`npx tsc -p tsconfig.json --noEmit`）と GUI E2E（`npm run e2e:electron`）で回帰確認する。

Rollback:
- `marked` の import と使用箇所を削除し、元のテキスト表示に戻す。
- `_handleChatClick`、`app:openExternal` ハンドラ、`openExternalUrl` preload 公開を削除する。

## Open Questions

- XSS 対策として `marked` の出力を DOMPurify などの sanitizer にかけるべきか（現状はモデル出力のみのため低リスク）。
