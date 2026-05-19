## 1. Session metadata と永続化の整備

- [x] 1.1 `Session` 型に `updatedAt` と `hasUnread` を追加し、既存 localStorage データを正規化する読み込み処理を実装する
- [x] 1.2 session 保存前に `updatedAt` 降順へ整列する共通処理を app に追加し、新規 session 作成と heartbeat session 作成へ適用する

## 2. 会話更新時の並び替えと未読制御

- [x] 2.1 session のメッセージ追加・更新・削除経路を共通 helper に寄せ、会話更新時に `updatedAt` を更新できるようにする
- [x] 2.2 非表示 session への assistant/system/error 更新で `hasUnread` を立て、session を開いた時に既読へ戻す処理を実装する

## 3. 一覧表示と契約テスト

- [x] 3.1 `lilt-chat-history` に未読ドット表示を追加し、active row と共存するレイアウトへ調整する
- [x] 3.2 session 一覧のソート順と未読 mark の付与・解除を固定する renderer UI 契約テストを追加または更新する