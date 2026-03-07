## 1. Skill 管理インターフェース整理

- [x] 1.1 `agent-skills` 要件に合わせて Main/IPC の Skill 管理 API（install/list/remove）責務を整理する
- [x] 1.2 `src/main/skill-runtime.ts` の一覧取得経路を `skills` ライブラリ整合前提へリファクタリングする
- [x] 1.3 `src/main/ipc.ts` の一覧・削除ハンドラを更新し、成功/失敗時の戻り値契約を統一する

## 2. 一覧・削除機能の実装

- [x] 2.1 `skills` ライブラリ準拠の一覧取得を実装し、symlink 形式 skill を含めて列挙する
- [x] 2.2 user skill 削除処理を `skills` 管理境界に合わせて実装し、bundled/system 削除を拒否する
- [x] 2.3 削除/一覧失敗時のエラー通知を UI ステータスへ伝播する

## 3. ランタイム反映と UI 連携

- [x] 3.1 install/remove 成功時に次回送信で反映されるセッション再同期処理を実装する
- [x] 3.2 `src/renderer/components/settings-modal.ts` の一覧表示/削除操作を新しい IPC 契約に合わせる
- [x] 3.3 文言と挙動（「次回送信から有効」）の整合を確認し、必要な UI 文言を調整する

## 4. 検証とドキュメント更新

- [x] 4.1 `test/skill-runtime.test.js` に一覧・削除・symlink・境界拒否の回帰テストを追加する
- [x] 4.2 build と関連テストを実行し、変更範囲の回帰がないことを確認する
- [x] 4.3 `tasks/lessons.md` と関連ドキュメントへ今回の管理方針（skills準拠）を追記する
