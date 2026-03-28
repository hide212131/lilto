## 1. Plugin domain と catalog 解決の追加

- [x] 1.1 plugin manifest / marketplace / install metadata の型と `PluginService` interface を Main 側に追加する
- [x] 1.2 lilto 組み込み marketplace と app-server が返す official curated marketplace を source catalog として扱う resolver を実装する
- [x] 1.3 marketplace entry の `./` prefix 検証と base path containment 検証を追加する

## 2. App-server plugin adapter の実装

- [x] 2.1 `plugin/list` / `plugin/read` / `plugin/install` / `plugin/uninstall` RPC を呼ぶ adapter を実装する
- [x] 2.2 app-server 応答を lilto の plugin UI state と metadata record へ写像する処理を実装する
- [x] 2.3 install / uninstall 後に `plugin/list` を再取得して UI state を再同期する処理を実装する

## 3. Codex runtime 連携の追加

- [x] 3.1 `AgentRuntime` が plugin service と同じ managed `HOME` / `CODEX_HOME` を使うように接続する
- [x] 3.2 plugin install / uninstall 後に plugin 関連 cache と runtime cache または session を refresh する処理を追加する
- [x] 3.3 install 済み plugin が次回送信または新規 thread から利用可能になることをテストで固定する

## 4. IPC / preload / renderer の拡張

- [x] 4.1 `plugins:list` / `plugins:install` / `plugins:uninstall` と必要な catalog 取得 IPC を追加する
- [x] 4.2 preload bridge と renderer 型定義へ plugin 管理 API を追加する
- [x] 4.3 Settings モーダルに `Plugins` タブを追加し、catalog 一覧、インストール済み一覧、install、uninstall、状態表示を実装する

## 5. テストとドキュメント更新

- [x] 5.1 marketplace parser と install metadata の unit test を追加する
- [x] 5.2 runtime integration test と Settings contract test を追加または更新する
- [x] 5.3 README / docs / OpenSpec 関連説明を plugin 管理仕様に合わせて更新する

## 6. 検証と仕上げ

- [x] 6.1 `tasks/lessons.md` に今回の学びを追記する
- [x] 6.2 plugin 管理 UI の manual verification を実施する
- [x] 6.3 最後に `npm run e2e:electron` を実行し、GUI 回帰がないことを確認する