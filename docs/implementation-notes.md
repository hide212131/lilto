# 実装メモ

- 本実装は音声入力・ウェイクワード機能を対象外とする。
- エージェント実行は `@mariozechner/pi-coding-agent` の SDK を Main プロセスから直接利用する。
- Claude OAuth は `@mariozechner/pi-ai` の OAuth API を使い、外部ブラウザ認証後に UI へコード入力して完了する。
- CLI を `spawn` / `exec` で別プロセス起動する経路は通常実行フローに含めない。
