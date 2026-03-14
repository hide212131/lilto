# 実装メモ

- 本実装は音声入力・ウェイクワード機能を対象外とする。
- エージェント実行は `@openai/codex-sdk` を使って Main プロセスの `AgentRuntime` から行う。
- 認証は Codex の ChatGPT OAuth または API key を使い、`CODEX_HOME` 配下の認証状態を参照する。
- Renderer は IPC 経由で Main の runtime を呼び出し、認証・skill・MCP server 連携は Main 側で扱う。
