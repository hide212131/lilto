# 実装メモ

- 本実装は音声入力・ウェイクワード機能を対象外とする。
- エージェント実行は `@mariozechner/pi-coding-agent` の SDK を Main プロセスから直接利用する。
- CLI を `spawn` / `exec` で別プロセス起動する経路は通常実行フローに含めない。
