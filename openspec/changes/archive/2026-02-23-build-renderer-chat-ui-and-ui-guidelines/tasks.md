## 1. UI ポーティング方針の具体化

- [x] 1.1 `pi-web-ui` / `pi-web-ui-example` の構成要素を棚卸しし、Lilt-AI で流用する要素と変更する要素を整理する
- [x] 1.2 Renderer で禁止する依存（ファイル I/O、Node/Electron Main 専用 API）と Main 側へ移管する基準を `docs/ui-porting-guidelines.md` へ反映する

## 2. Renderer チャット UI 実装

- [x] 2.1 ユーザー入力欄、送信操作、メッセージ一覧を会話形式で表示する UI を実装する
- [x] 2.2 送信中状態の表示と重複送信防止を実装し、応答受信時に状態を復帰させる
- [x] 2.3 エラー応答を会話コンテキストで表示し、失敗後に再送可能な UI 状態遷移を実装する

## 3. Main/Renderer 境界の調整

- [x] 3.1 UI 変更で追加された処理のうち Renderer 非対応依存を含むものを Main 側へ移管する
- [x] 3.2 IPC インターフェースを更新し、Renderer は表示と入力受付に限定されることを確認する

## 4. 検証と完了条件

- [x] 4.1 単体または統合テストでチャット送受信・失敗時挙動を確認する
- [x] 4.2 GUI 変更として `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` 生成を確認する
- [x] 4.3 `docs/ui-porting-guidelines.md` の方針更新内容と実装の整合をレビューして変更を確定する
