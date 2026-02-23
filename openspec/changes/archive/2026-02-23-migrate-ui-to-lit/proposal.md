## Why

現在の Renderer は `index.html` に 400 行超のインライン CSS と素の DOM 操作スクリプト（`renderer.ts` 380 行）が混在しており、UIの拡張・デバッグが困難になっている。Lit ベースのウェブコンポーネントに移行することで、コンポーネント単位の責務分離・リアクティブな状態管理・型安全テンプレートを実現し、今後の機能追加コストを下げる。

## What Changes

- `src/renderer/index.html` のインライン CSS と HTML 構造をすべて削除し、Lit コンポーネントのエントリポイントのみに縮小する
- `src/renderer/renderer.ts` の生 DOM 操作をすべて Lit コンポーネントのリアクティブプロパティ・イベントに置き換える
- `lit` パッケージを devDependency として追加し、Vite／tsconfig を decorator 対応に更新する（**BREAKING**: ビルド成果物のファイル構成が変わる）
- 既存の UI 要件（チャット送受信・送信中表示・エラー表示・設定モーダル・Claude OAuth・Custom Provider 設定）はすべて維持する

## Capabilities

### New Capabilities

- `lit-renderer-setup`: Lit パッケージ追加・Vite / tsconfig 設定変更・コンポーネントファイル構成の定義
- `lit-chat-app`: チャット UI 全体のLit コンポーネント群（TopBar、MessageList、Composer、SettingsModal）の実装仕様

### Modified Capabilities

（なし：機能要件は既存 spec のまま変更なし）

## Impact

- **変更ファイル**: `src/renderer/index.html`、`src/renderer/renderer.ts`（ともに全面書き換え）、`package.json`、`vite.config.ts`（または相当するビルド設定）、`tsconfig.json`
- **新規ファイル**: `src/renderer/components/` 以下に各 Lit コンポーネント（`.ts`）を追加
- **依存関係**: `lit`（npm パッケージ）を追加。ランタイム依存なし（Vite でバンドル済み）
- **IPC 契約**: `window.lilto.*` の型定義は変更なし。Main プロセス側への影響はない
- **既存 spec との関係**: `renderer-chat-ui`（機能要件）・`renderer-ui-porting-guidelines`（設計方針）は参照のみ。要件変更なし
