const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentRuntime } = require("../dist/main/agent-sdk.js");

function createAuthService(phase, apiKey = "oauth-api-key", provider = "anthropic") {
  return {
    getState() {
      return { phase, provider };
    },
    async getApiKey(requestedProvider) {
      assert.equal(requestedProvider, provider);
      return apiKey;
    }
  };
}

function createProviderSettings(overrides = {}) {
  return {
    activeProvider: "claude",
    oauthProvider: "anthropic",
    customProvider: {
      name: "",
      baseUrl: "",
      apiKey: "",
      modelId: "gpt-4.1-mini"
    },
    networkProxy: {
      httpProxy: "",
      httpsProxy: "",
      noProxy: ""
    },
    updatedAt: Date.now(),
    ...overrides
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
  runtime["sessionKey"] = JSON.stringify({
    apiKey: "oauth-api-key",
    provider: "anthropic",
    model: "default",
    baseUrl: "",
    cwd: process.cwd()
  });

  const result = await runtime.submitPrompt("test", createProviderSettings());
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

  const result = await runtime.submitPrompt("test", createProviderSettings());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUTH_REQUIRED");
});

test("認証済みでも provider 不一致なら AUTH_REQUIRED を返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated", "oauth-api-key", "anthropic"),
    createSession: async () => {
      throw new Error("should not be called");
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      oauthProvider: "openai-codex"
    })
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUTH_REQUIRED");
  assert.match(result.error.message, /openai-codex/);
});

test("Custom Provider 未設定なら PROVIDER_CONFIG_REQUIRED を返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => {
      throw new Error("should not be called");
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      activeProvider: "custom-openai-completions"
    })
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_CONFIG_REQUIRED");
});

test("Custom Provider 設定済みなら custom model で実行される", async () => {
  let receivedOptions;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      receivedOptions = options;
      return {
        subscribe(listener) {
          listener({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "custom-ok" }
          });
          return () => {};
        },
        async prompt() {}
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      activeProvider: "custom-openai-completions",
      customProvider: {
        name: "my-custom",
        baseUrl: "https://example.com/v1",
        apiKey: "custom-key",
        modelId: "gpt-4o-mini"
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, "custom-ok");
  assert.equal(receivedOptions.apiKey, "custom-key");
  assert.equal(receivedOptions.model.provider, "custom-openai-completions");
  assert.equal(receivedOptions.model.baseUrl, "https://example.com/v1");
  assert.equal(receivedOptions.model.id, "gpt-4o-mini");
});

test("Custom Provider の Ollama URL は /v1 を補完する", async () => {
  let receivedOptions;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      receivedOptions = options;
      return {
        subscribe(listener) {
          listener({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "ok" }
          });
          return () => {};
        },
        async prompt() {}
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      activeProvider: "custom-openai-completions",
      customProvider: {
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434",
        apiKey: "",
        modelId: "qwen2.5:0.5b"
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(receivedOptions.model.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(receivedOptions.apiKey, "ollama");
});

test("text_delta がなくても done イベントから応答を復元する", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "done",
            message: {
              content: [{ type: "text", text: "done-text" }]
            }
          }
        });
        return () => {};
      },
      async prompt() {}
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test", createProviderSettings());
  assert.equal(result.ok, true);
  assert.equal(result.text, "done-text");
});

test("delta と done が両方来ても重複せず最終テキストを返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "partial" }
        });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "done",
            message: {
              content: [{ type: "text", text: "final" }]
            }
          }
        });
        return () => {};
      },
      async prompt() {}
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test", createProviderSettings());
  assert.equal(result.ok, true);
  assert.equal(result.text, "final");
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

  const result = await runtime.submitPrompt("test", createProviderSettings());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AGENT_EXECUTION_FAILED");
  assert.equal(result.error.retryable, true);
});

test("Proxy precheck 失敗時に標準化エラーを返す", async () => {
  process.env.LILTO_E2E_MOCK = "1";
  process.env.LILTO_PROXY_TEST_URL = "http://127.0.0.1:1/probe";
  try {
    const runtime = new AgentRuntime({
      authService: createAuthService("authenticated"),
      createSession: async () => {
        throw new Error("should not create session");
      },
      logger: { info() {}, error() {} }
    });

    const result = await runtime.submitPrompt(
      "test",
      createProviderSettings({
        activeProvider: "custom-openai-completions",
        customProvider: {
          name: "my-custom",
          baseUrl: "https://example.com/v1",
          apiKey: "custom-key",
          modelId: "gpt-4o-mini"
        }
      })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PROXY_CONNECTION_FAILED");
  } finally {
    delete process.env.LILTO_E2E_MOCK;
    delete process.env.LILTO_PROXY_TEST_URL;
  }
});

test("ブラウザ依頼時は agent-browser スキルを優先する", async () => {
  let receivedPrompt = "";
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "ok" }
        });
        return () => {};
      },
      async prompt(text) {
        receivedPrompt = text;
      }
    }),
    availableSkills: [{ name: "agent-browser" }],
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("ブラウザで動作確認して", createProviderSettings());
  assert.equal(result.ok, true);
  assert.equal(receivedPrompt.startsWith("/skill:agent-browser"), true);
});

test("スキル化依頼時は skill-creator スキルを優先する", async () => {
  let receivedPrompt = "";
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "ok" }
        });
        return () => {};
      },
      async prompt(text) {
        receivedPrompt = text;
      }
    }),
    availableSkills: [{ name: "agent-browser" }, { name: "skill-creator" }],
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("この手順を再現できるようにスキルにして", createProviderSettings());
  assert.equal(result.ok, true);
  assert.equal(receivedPrompt.startsWith("/skill:skill-creator"), true);
});

test("明示 /skill 指定がある場合は自動補正しない", async () => {
  let receivedPrompt = "";
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "ok" }
        });
        return () => {};
      },
      async prompt(text) {
        receivedPrompt = text;
      }
    }),
    availableSkills: [{ name: "agent-browser" }, { name: "skill-creator" }],
    logger: { info() {}, error() {} }
  });

  const explicit = "/skill:agent-browser\n\nこの手順をスキル化して";
  const result = await runtime.submitPrompt(explicit, createProviderSettings());
  assert.equal(result.ok, true);
  assert.equal(receivedPrompt, explicit);
});

test("agent-browser が無い場合はスキル接頭辞を付けない", async () => {
  let receivedPrompt = "";
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "ok" }
        });
        return () => {};
      },
      async prompt(text) {
        receivedPrompt = text;
      }
    }),
    availableSkills: [],
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("ブラウザで動作確認して", createProviderSettings());
  assert.equal(result.ok, true);
  assert.equal(receivedPrompt, "ブラウザで動作確認して");
});

test("loop event 正規化: tool start/end を送出する", async () => {
  const loopEvents = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "tool_execution_start",
          toolCallId: "call-1",
          toolName: "bash"
        });
        listener({
          type: "tool_execution_end",
          toolCallId: "call-1",
          toolName: "bash",
          isError: false
        });
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "ok" }
        });
        return () => {};
      },
      async prompt() {}
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test", createProviderSettings(), {
    requestId: "req-1",
    onLoopEvent: (event) => {
      loopEvents.push(event);
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(loopEvents, [
    { type: "tool_execution_start", requestId: "req-1", toolCallId: "call-1", toolName: "bash" },
    { type: "tool_execution_end", requestId: "req-1", toolCallId: "call-1", toolName: "bash", isError: false }
  ]);
});

test("loop event 正規化: tool error を送出する", async () => {
  const loopEvents = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "tool_execution_start",
          toolCallId: "call-err",
          toolName: "edit"
        });
        listener({
          type: "tool_execution_end",
          toolCallId: "call-err",
          toolName: "edit",
          isError: true
        });
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "failed" }
        });
        return () => {};
      },
      async prompt() {}
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test", createProviderSettings(), {
    requestId: "req-2",
    onLoopEvent: (event) => {
      loopEvents.push(event);
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(loopEvents.at(-1), {
    type: "tool_execution_end",
    requestId: "req-2",
    toolCallId: "call-err",
    toolName: "edit",
    isError: true
  });
});
