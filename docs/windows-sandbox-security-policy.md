# Windows Sandbox Security Policy

この文書は、lilto が Codex の Windows sandbox backend を使うときに、何を security boundary として扱うかを定義する。

## 基本方針

- lilto は独自の Windows sandbox を実装しない
- Windows sandbox の実際のアクセス制御は Codex の `windows-sandbox-rs` 実装に従う
- lilto 側は setup 導線、`workspace-write` での起動条件、設定保存、エラー標準化だけを責務とする

## lilto が保証すること

- Windows で sandbox mode が `unelevated` または `elevated` の場合、Codex thread は `workspace-write` で起動する
- `windows.sandbox` と `windows.sandbox_private_desktop` を Codex へ渡す
- setup 未完了や backend 失敗は標準化エラーとして UI に返す
- live 検証では、Codex の既存 smoke test と整合する最小限の拒否動作を確認する

## live test の判定対象

- workspace 内の通常ファイル書き込みが成功すること
- `cmd /c echo ... > <outside path>` のような workspace 外書き込みが拒否されること
- named pipe 作成が拒否されること
- raw device access が拒否されること

## lilto が保証しないこと

- すべての Windows ファイル API や shell が、workspace 外の絶対パス書き込みを一律で拒否すること
- NTFS Alternate Data Streams (`file.txt:stream`) を常に拒否すること
- Codex upstream が明示していない拒否動作を、lilto が独自仕様として上乗せすること

## 現時点の分析結果

- `windows-sandbox-rs` は主に restricted token と ACL に依存している
- allow / deny roots は setup 時に配布され、per-command の絶対パス検査を前提としていない
- そのため、PowerShell の絶対パス書き込みや ADS は upstream 実装の保証対象としては扱わない
- これらは regression gate ではなく、必要なら upstream へ再現テストとともに報告する調査項目として扱う

## 運用ルール

- Windows sandbox 変更の完了判定は、この文書の「live test の判定対象」を満たすことを基準にする
- 追加の拒否ケースを gate に入れるのは、Codex upstream の smoke test または仕様文書で保証が確認できた後に限る