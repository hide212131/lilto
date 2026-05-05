## 1. Environment helper

- [x] 1.1 Windows の persistent User/Machine environment を取得する helper を追加し、補完対象 key を定義する
- [x] 1.2 `PATH` の重複排除付き merge と lilto 管理 override 再適用を行う pure function を実装する
- [x] 1.3 Codex SDK 向けの非同期 environment resolver を追加し、失敗時フォールバックとプロセス内キャッシュを実装する

## 2. Runtime integration

- [x] 2.1 `createCodexThreadFromSdk()` を新しい environment resolver 利用へ切り替える
- [x] 2.2 `CODEX_HOME`、packaged Codex path、scheduler bridge env、Windows PowerShell path 補助の優先順を新 resolver 上で維持する
- [x] 2.3 必要なら共有 helper の API を auth/app-server でも再利用しやすい形に整理する

## 3. Tests and verification

- [x] 3.1 environment merge ルールの単体テストを追加し、`PATH` 補完・重複除去・override 優先を確認する
- [x] 3.2 Windows の environment 取得失敗時フォールバックを確認するテストを追加する
- [x] 3.3 Agent runtime のテストを更新し、Codex SDK に正規化済み env が渡ることを確認する
- [x] 3.4 `openspec status --change normalize-electron-codex-environment` を実行し、apply-ready であることを確認する