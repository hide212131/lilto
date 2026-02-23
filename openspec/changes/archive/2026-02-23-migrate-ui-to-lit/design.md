## Context

現在のRenderer は `src/renderer/index.html`（504行、インラインCSS+HTML）と `src/renderer/renderer.ts`（380行、生DOM操作）で構成される。ビルドは `tsc -p tsconfig.json` 一本で CommonJS に変換され、`dist/renderer/renderer.js` として HTML から `<script>` タグで読み込まれる。

Electron のプロセス構成:
- **Main**: `src/main/` — Node.js/CommonJS、IPC ハンドラ
- **Preload**: `src/preload.ts` — `contextBridge` 経由で `window.lilto.*` を公開
- **Renderer**: `src/renderer/` — ブラウザ環境、`window.lilto.*` 経由で Main と通信

制約: Renderer はブラウザ環境（Chromium）で動作するため、Node.js API 非対応。

## Goals / Non-Goals

**Goals:**
- Renderer の UI を Lit Web Components に移行する
- コンポーネントごとに責務を分離し、ファイルを分割する
- 既存の `window.lilto.*` IPC 契約を維持する（Main・Preload に変更なし）
- Renderer 専用の ESM ビルドを導入する（Lit は ESM 前提）

**Non-Goals:**
- Main プロセスや IPC 構造の変更
- デザイン（CSS）の刷新
- Tauri/Vite への移行（このチェンジのスコープ外）
- テストの追加

## Decisions

### 1. Renderer に Vite を導入する（tsc 単体から移行）

**理由**: Lit は ESM モジュールを前提とし、TypeScript デコレータも必要。現在の `tsconfig.json` は `module: CommonJS` で全プロセス共通のため、Renderer だけを ESM・デコレータ対応でビルドする別手段が必要。

**選択**: Vite を Renderer 専用のバンドラーとして追加する。
- `vite.config.ts` を新設し、`src/renderer/` を entry とした ESM バンドルを `dist/renderer/` に出力する
- Main/Preload は既存の `tsconfig.json` + `tsc` のままとする
- `package.json` の `build` スクリプトを `tsc && vite build` に変更する

**代替案**:
- esbuild 直接 — 軽量だが HMR など開発体験が劣る
- tsconfig を分割して ESM 出力 — Lit デコレータ対応が複雑
- Lit のデコレータなし記法 — 可能だが冗長でコミュニティ標準から外れる

### 2. コンポーネント分割: 4コンポーネント + 1エントリポイント

```
src/renderer/
  app.ts               ← <lilt-app> ルートコンポーネント（状態管理）
  components/
    top-bar.ts         ← <lilt-top-bar>
    message-list.ts    ← <lilt-message-list>
    composer.ts        ← <lilt-composer>
    settings-modal.ts  ← <lilt-settings-modal>
  index.html           ← <lilt-app> を差し込むだけのシェル
```

`<lilt-app>` が `authState` / `providerSettings` / `messages` / `isSending` を Lit リアクティブプロパティで管理し、子コンポーネントへ `@property` + カスタムイベントで伝達する。

**理由**: 現在の `renderer.ts` に集まっているグローバル変数（`authState`, `providerSettings`, `isSending`）を `<lilt-app>` の state として一元管理することで、DOM 操作の副作用を排除できる。

### 3. TypeScript デコレータ: experimentalDecorators を使用

Lit v3 は TC39 Stage 3 デコレータにも対応しているが、tsconfig 側の対応が複雑になる。Renderer 専用 tsconfig で `experimentalDecorators: true` + `useDefineForClassFields: false` を設定する方が確実。

## Risks / Trade-offs

| リスク | 緩和策 |
|---|---|
| Vite 導入でビルドチェーンが複雑になる | Renderer 専用設定に限定し、Main/Preload は変更しない |
| Lit のバンドルサイズ増加（~20KB gzip） | Electron 埋め込みのため問題にならない |
| Lit の Shadow DOM が既存 CSS と競合する | インラインスタイルを各コンポーネントの `static styles` に移植するため競合しない |
| `window.lilto.*` の型定義が renderer.ts に埋め込まれている | 型定義を `src/types/` か Renderer tsconfig の `lib` に分離する |

## Migration Plan

1. Vite と Lit を devDependency に追加 (`npm install -D vite lit`)
2. `vite.config.ts` と Renderer 専用 `tsconfig.renderer.json` を新設
3. `src/renderer/components/` に各 Lit コンポーネントを作成
4. `src/renderer/app.ts` にルートコンポーネントを実装
5. `src/renderer/index.html` を最小シェルに置き換え
6. `src/renderer/renderer.ts` を削除
7. `package.json` の `build` スクリプトを更新
8. 動作確認（`npm start`）

ロールバック: 手順は独立ステップのため、各段階で git revert 可能。

## Open Questions

- `src/types/` に型定義を切り出すか、各コンポーネントで import するか（tasks で決定）
- Vite の `base` パス設定（Electron の file:// プロトコルに対応）— `base: './'` が必要な可能性あり
