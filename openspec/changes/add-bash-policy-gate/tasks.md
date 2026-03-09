## 1. Runtime wiring

- [x] 1.1 `src/main/agent-sdk.ts` に app 管理 extension を読み込む `ResourceLoader` 構成を追加し、Pi session 作成時に Bash policy gate を有効化する
- [x] 1.2 `src/main/config.ts` に policy path、audit log path、fail-safe mode などの設定解決を追加する
- [x] 1.3 Windows 互換実行経路と既存 custom tools を維持したまま、policy gate 追加後も agent runtime が起動できることを確認する

## 2. Policy engine

- [x] 2.1 YAML 設定を読み込む `PolicyLoader` と schema 検証を実装する
- [x] 2.2 コマンド正規化と rule evaluation を行う `PolicyEngine` を実装し、`deny` / `confirm` / `allow` / `audit` と一致ルールを返せるようにする
- [x] 2.3 `protectedPaths` 判定、非対話 fail-safe、設定破損時 fallback を engine と adapter へ実装する

## 3. Extension adapter and logging

- [x] 3.1 Pi extension として `tool_call` で `bash` のみを検査する gate adapter を実装する
- [x] 3.2 `confirm` 判定時に理由付き UI 確認、`deny` 判定時に理由付き block 応答を返す
- [x] 3.3 監査ログを JSON Lines 形式で出力し、少なくとも `deny` / `confirm` / `audit` を記録する

## 4. Verification

- [x] 4.1 `rm -rf`, `sudo`, `git push`, `ls`, `.env` 操作、未一致コマンド、設定破損時 fallback の自動テストを追加する
- [x] 4.2 `sh -c`, `bash -lc`, `xargs`, `&&`, `;` を含む回避パターンの判定テストを追加する
- [x] 4.3 実 runtime で policy gate が `bash` 実行前に介在する統合確認を行い、既存挙動との差分を検証する
- [x] 4.4 実装完了後に OpenSpec artifacts と `tasks/lessons.md` を更新し、設計・検証結果を同期する
