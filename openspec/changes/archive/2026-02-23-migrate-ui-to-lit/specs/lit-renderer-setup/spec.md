## ADDED Requirements

### Requirement: Vite による Renderer ESM ビルド
システムは、`src/renderer/` を entry とした Vite ビルド設定を持ち、`dist/renderer/` に ESM バンドルを出力しなければならない（MUST）。出力ファイルは Electron の `file://` プロトコルで正常に動作しなければならない（MUST）。

#### Scenario: npm run build で Renderer が正しく出力される
- **WHEN** `npm run build` を実行する
- **THEN** `dist/renderer/index.html` と対応するバンドル JS ファイルが生成される

#### Scenario: Electron 起動時に Renderer が読み込まれる
- **WHEN** Electron が起動して Main ウィンドウを開く
- **THEN** `dist/renderer/index.html` が正常に読み込まれ、ブラウザコンソールにエラーがない

### Requirement: Renderer 専用 TypeScript 設定
システムは、Renderer 用の tsconfig（`tsconfig.renderer.json`）を別途持ち、`experimentalDecorators: true`、`useDefineForClassFields: false`、`module: ESNext` を設定しなければならない（MUST）。Main/Preload の tsconfig（`tsconfig.json`）は変更してはならない（MUST NOT）。

#### Scenario: Lit デコレータが TypeScript コンパイルエラーなしで使える
- **WHEN** `@customElement('lilt-app')` や `@property()` デコレータを Renderer コンポーネントで使用する
- **THEN** tsc および Vite のビルドがエラーなく完了する

### Requirement: Lit パッケージの導入
システムは `lit` パッケージ（v3 以上）を devDependency に含まなければならない（MUST）。

#### Scenario: Lit がバンドルに含まれる
- **WHEN** Vite ビルドを実行する
- **THEN** `lit` ライブラリがバンドルに含まれ、Renderer が Lit コンポーネントを正常に描画する
