## loop event 調査メモ

参照:
- `PI_REPO_DIR/packages/agent/src/agent.ts`
- `PI_REPO_DIR/packages/agent/src/types.ts`
- `PI_REPO_DIR/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `PI_REPO_DIR/packages/web-ui/example/src/main.ts`

確認したイベント種別（今回採用）:
- `tool_execution_start`: ツール開始。`toolCallId` と `toolName` が取得できる。
- `tool_execution_end`: ツール終了。`toolCallId` / `toolName` に加え `isError` が取得できる。
- `thinking_start` / `thinking_end`: 思考開始・終了を示す。

終端系の扱い:
- SDKイベントとしては `agent_end` など終端イベントがあるが、UI整合のため Main IPC 側で `run_end` を共通送出する。
- `run_end` は正常完了・失敗・中断の全経路で送出し、Renderer 側の進行中表示を必ずクリアする。

互換性方針:
- 既存 `agent:submitPrompt` の request/response 契約は変更しない。
- 追加は push 通知チャネル（`agent:loopEvent`）のみとする。
