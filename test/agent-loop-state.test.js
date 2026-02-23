const test = require("node:test");
const assert = require("node:assert/strict");

const { createInitialLoopState, reduceLoopState } = require("../dist/shared/agent-loop.js");

test("loop state: tool start/end で実行中ツール一覧が更新される", () => {
  let state = createInitialLoopState();
  state = reduceLoopState(state, { type: "run_start", requestId: "req-1" });
  state = reduceLoopState(state, {
    type: "tool_execution_start",
    requestId: "req-1",
    toolCallId: "t-1",
    toolName: "bash"
  });

  assert.equal(state.status, "running");
  assert.equal(state.activeTools.length, 1);
  assert.equal(state.activeTools[0].toolName, "bash");

  state = reduceLoopState(state, {
    type: "tool_execution_end",
    requestId: "req-1",
    toolCallId: "t-1",
    toolName: "bash",
    isError: false
  });

  assert.equal(state.activeTools.length, 0);
  assert.equal(state.status, "running");
});

test("loop state: run_end で進行中状態をクリアする", () => {
  let state = createInitialLoopState();
  state = reduceLoopState(state, { type: "run_start", requestId: "req-2" });
  state = reduceLoopState(state, {
    type: "tool_execution_start",
    requestId: "req-2",
    toolCallId: "t-2",
    toolName: "read"
  });

  state = reduceLoopState(state, {
    type: "run_end",
    requestId: "req-2",
    status: "failed",
    errorMessage: "boom"
  });

  assert.equal(state.status, "failed");
  assert.equal(state.activeTools.length, 0);
  assert.equal(state.lastError, "boom");
});

