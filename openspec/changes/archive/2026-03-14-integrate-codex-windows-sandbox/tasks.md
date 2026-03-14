## 1. 設定モデルと Main 共通基盤

- [x] 1.1 `src/shared/provider-settings.ts` と `src/main/provider-settings.ts` を拡張し、`windowsSandbox.mode` と `windowsSandbox.privateDesktop` を保存・正規化できるようにする
- [x] 1.2 `src/main` に Codex app-server 用の共通 stdio クライアントを追加し、initialize・request・notification 待機・終了処理を再利用可能にする
- [x] 1.3 `src/main/model-catalog.ts` のモデル一覧取得を共通 app-server クライアントへ寄せ、既存機能が後退しないことを確認する

## 2. Windows sandbox 設定 UI と setup 導線

- [x] 2.1 `src/renderer/components/settings-modal.ts` に Windows 専用の sandbox 設定セクションを追加し、`off` / `unelevated` / `elevated` と private desktop の選択 UI を表示する
- [x] 2.2 `src/main/ipc.ts` に Windows sandbox setup 開始・結果返却の IPC を追加し、設定保存時に `windowsSandbox/setupStart` を呼べるようにする
- [x] 2.3 setup 成功・失敗・キャンセル時に Settings UI の状態文言と保存結果を更新し、失敗時は `off` へ安全側フォールバックする

## 3. Agent runtime の sandbox 実行切替

- [x] 3.1 `src/main/agent-sdk.ts` の thread 起動設定を Windows sandbox モードに応じて切り替え、Windows では `workspace-write` と `windows.sandbox` config override を渡す
- [x] 3.2 Windows sandbox 未完了・未対応モード・backend 失敗を lilto の標準化エラーコードへ変換し、Renderer が設定画面再表示に使えるようにする
- [x] 3.3 provider settings 更新時に既存 AgentRuntime セッションを破棄または再生成し、新しい sandbox 設定が次回送信から必ず反映されるようにする

## 4. テストと動作確認

- [x] 4.1 provider settings と IPC の unit test を追加し、Windows sandbox 設定の正規化、保存、setup 失敗時フォールバックを検証する
- [x] 4.2 agent runtime 周辺の test を追加し、Windows sandbox 有効時に `workspace-write` と Codex config が渡されること、および setup 未完了時エラーを検証する
- [x] 4.3 Windows 実機または Windows 前提テストで、設定保存から setup 実行、prompt 実行経路、失敗時の UI 案内までを確認する