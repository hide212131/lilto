## 1. ビルド環境セットアップ

- [x] 1.1 `npm install -D vite lit` を実行して依存を追加する
- [x] 1.2 `vite.config.ts` を新設する（entry: `src/renderer/index.html`、base: `'./'`、outDir: `dist/renderer`）
- [x] 1.3 `tsconfig.renderer.json` を新設する（`experimentalDecorators: true`、`useDefineForClassFields: false`、`module: ESNext`、`target: ES2022`）
- [x] 1.4 `package.json` の `build` スクリプトを `tsc -p tsconfig.json && vite build` に更新する

## 2. コンポーネント雛形の作成

- [x] 2.1 `src/renderer/components/` ディレクトリを作成する
- [x] 2.2 `src/renderer/components/top-bar.ts` に `<lilt-top-bar>` の Lit コンポーネント雛形を作成する
- [x] 2.3 `src/renderer/components/message-list.ts` に `<lilt-message-list>` の Lit コンポーネント雛形を作成する
- [x] 2.4 `src/renderer/components/composer.ts` に `<lilt-composer>` の Lit コンポーネント雛形を作成する
- [x] 2.5 `src/renderer/components/settings-modal.ts` に `<lilt-settings-modal>` の Lit コンポーネント雛形を作成する
- [x] 2.6 `src/renderer/app.ts` に `<lilt-app>` ルートコンポーネントの雛形を作成する

## 3. lilt-top-bar の実装

- [x] 3.1 アプリ名（「Lilt-o」）・ステータス表示・設定ボタン（⚙）を描画する
- [x] 3.2 `isSending` プロパティを受け取り、ステータステキストを切り替える
- [x] 3.3 設定ボタンクリック時に `open-settings` カスタムイベントを発火する
- [x] 3.4 既存のトップバー CSS スタイルを `static styles` に移植する

## 4. lilt-message-list の実装

- [x] 4.1 `messages` プロパティ（`Array<{role, text, pending?}>`）を受け取って描画する
- [x] 4.2 role（user / assistant / system / error）に応じたスタイルを適用する
- [x] 4.3 `updated()` で最下部へ自動スクロールする処理を実装する
- [x] 4.4 既存のメッセージ関連 CSS を `static styles` に移植する

## 5. lilt-composer の実装

- [x] 5.1 `textarea` と「送信」ボタンを描画する
- [x] 5.2 `disabled` プロパティを受け取り、ボタンと textarea を無効化する
- [x] 5.3 送信ボタンクリック時に `send-message` カスタムイベントを入力テキスト付きで発火する
- [x] 5.4 Cmd+Enter / Ctrl+Enter でも `send-message` を発火する（IME 考慮）
- [x] 5.5 既存の composer/textarea/button CSS を `static styles` に移植する

## 6. lilt-settings-modal の実装

- [x] 6.1 `open` プロパティで表示/非表示を切り替える
- [x] 6.2 プロバイダー選択 UI（Claude / Custom Provider ラジオボタン）を実装する
- [x] 6.3 Claude OAuth UI（認証ボタン・認証コード入力行）を実装する
- [x] 6.4 Custom Provider フォーム（name / baseUrl / apiKey / modelId）を実装する
- [x] 6.5 設定保存後に `provider-settings-changed` カスタムイベントを発火する
- [x] 6.6 Claude 認証完了後に `close-settings` カスタムイベントを発火する
- [x] 6.7 Escape キーおよびバックドロップクリックで閉じる処理を実装する
- [x] 6.8 既存のモーダル関連 CSS を `static styles` に移植する

## 7. lilt-app ルートコンポーネントの実装

- [x] 7.1 `authState`・`providerSettings`・`messages`・`isSending` をリアクティブプロパティとして定義する
- [x] 7.2 `connectedCallback` で `getAuthState()` と `getProviderSettings()` を呼び出す
- [x] 7.3 `onAuthStateChanged` リスナーを登録し、`disconnectedCallback` で解除する
- [x] 7.4 `send-message` イベントを受け取り、`window.lilto.submitPrompt()` を呼び出すハンドラを実装する
- [x] 7.5 `provider-settings-changed` イベントを受け取り、`window.lilto.saveProviderSettings()` を呼び出すハンドラを実装する
- [x] 7.6 子コンポーネントにプロパティとイベントをバインドして `render()` する

## 8. index.html の最小化と旧 renderer.ts の削除

- [x] 8.1 `src/renderer/index.html` を `<lilt-app>` とスクリプト参照のみの最小シェルに書き換える
- [x] 8.2 `src/renderer/renderer.ts` を削除する

## 9. 動作確認

- [x] 9.1 `npm run build` がエラーなく完了することを確認する
- [x] 9.2 `npm start` で Electron が起動し、チャット UI が正常に表示されることを確認する
- [x] 9.3 メッセージ送受信が動作することを確認する（送信中表示・応答表示・エラー表示）
- [x] 9.4 設定モーダルの開閉・Claude OAuth・Custom Provider 保存が動作することを確認する
