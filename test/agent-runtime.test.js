const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/main/agent-sdk.js");

function createAuthService(phase, apiKey = "oauth-api-key") {
  return {
    getState() {
      return { phase };
    },
    async getApiKey() {
      return apiKey;
    }
  };
}

test("認証済みなら SDK 応答を返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        const handler = listener;
        return () => handler;
      },
      async prompt() {}
    }),
    logger: { info() {}, error() {} }
  });

  // Inject text delta through a custom session to emulate SDK output.
  runtime["session"] = {
    subscribe(listener) {
      listener({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" }
      });
      return () => {};
    },
    async prompt() {}
  };
  runtime["sessionApiKey"] = "oauth-api-key";

  const result = await runtime.submitPrompt("test");
  assert.equal(result.ok, true);
  assert.equal(result.text, "hello");
});

test("未認証なら AUTH_REQUIRED を返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("unauthenticated"),
    createSession: async () => {
      throw new Error("should not be called");
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUTH_REQUIRED");
});

test("SDK 失敗時に標準化エラーを返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe() {
        return () => {};
      },
      async prompt() {
        throw new Error("sdk boom");
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AGENT_EXECUTION_FAILED");
  assert.equal(result.error.retryable, true);
});
