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
      useProxy: false
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

test("useProxy が OFF の場合は環境変数の Proxy を使わない", async () => {
  const prevHttpProxy = process.env.HTTP_PROXY;
  process.env.HTTP_PROXY = "http://proxy.local:8080";
  let observedHttpProxy = null;

  try {
    const runtime = new AgentRuntime({
      authService: createAuthService("authenticated"),
      createSession: async () => {
        observedHttpProxy = process.env.HTTP_PROXY ?? null;
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

    const result = await runtime.submitPrompt("test", createProviderSettings());
    assert.equal(result.ok, true);
    assert.equal(observedHttpProxy, null);
  } finally {
    if (prevHttpProxy === undefined) {
      delete process.env.HTTP_PROXY;
    } else {
      process.env.HTTP_PROXY = prevHttpProxy;
    }
  }
});

test("useProxy が ON の場合は環境変数の Proxy を使う", async () => {
  const prevHttpProxy = process.env.HTTP_PROXY;
  process.env.HTTP_PROXY = "http://proxy.local:8080";
  let observedHttpProxy = null;

  try {
    const runtime = new AgentRuntime({
      authService: createAuthService("authenticated"),
      createSession: async () => {
        observedHttpProxy = process.env.HTTP_PROXY ?? null;
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
        networkProxy: { useProxy: true }
      })
    );
    assert.equal(result.ok, true);
    assert.equal(observedHttpProxy, "http://proxy.local:8080");
  } finally {
    if (prevHttpProxy === undefined) {
      delete process.env.HTTP_PROXY;
    } else {
      process.env.HTTP_PROXY = prevHttpProxy;
    }
  }
});

test("E2E mock は thinking と複数コマンド進行を通知し最終回答を返す", async () => {
  process.env.LILTO_E2E_MOCK = "1";
  const loopEvents = [];

  try {
    const runtime = new AgentRuntime({
      authService: createAuthService("authenticated"),
      createSession: async () => {
        throw new Error("should not create session in mock mode");
      },
      logger: { info() {}, error() {} }
    });

    const result = await runtime.submitPrompt("mock request", createProviderSettings(), {
      requestId: "req-mock-1",
      onLoopEvent: (event) => {
        loopEvents.push(event);
      }
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.text,
      "[E2E_MOCK_FINAL] 要求「mock request」を処理し、複数コマンドを実行して回答しました。"
    );

    assert.deepEqual(loopEvents, [
      { type: "thinking_start", requestId: "req-mock-1" },
      {
        type: "thinking_delta",
        requestId: "req-mock-1",
        delta: "要求を分解し、必要な手順を確認します。\n"
      },
      {
        type: "thinking_delta",
        requestId: "req-mock-1",
        delta: "読み取りとコマンド実行の順で進めます。\n"
      },
      { type: "thinking_end", requestId: "req-mock-1" },
      {
        type: "tool_execution_start",
        requestId: "req-mock-1",
        toolCallId: "mock-read-1",
        toolName: "read_file",
        args: { command: "read_file README.md" }
      },
      {
        type: "tool_execution_end",
        requestId: "req-mock-1",
        toolCallId: "mock-read-1",
        toolName: "read_file",
        isError: false
      },
      {
        type: "tool_execution_start",
        requestId: "req-mock-1",
        toolCallId: "mock-run-1",
        toolName: "run_in_terminal",
        args: { command: "npm run check" }
      },
      {
        type: "tool_execution_end",
        requestId: "req-mock-1",
        toolCallId: "mock-run-1",
        toolName: "run_in_terminal",
        isError: false
      }
    ]);
  } finally {
    delete process.env.LILTO_E2E_MOCK;
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

test("liltobook heartbeat は候補を提案し、承認後に skill-creator を実行する", async () => {
  const prompts = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "手順を整理しました。" }
        });
        return () => {};
      },
      async prompt(text) {
        prompts.push(text);
      }
    }),
    availableSkills: [{ name: "liltobook" }, { name: "skill-creator" }],
    logger: { info() {}, error() {} }
  });

  const initial = await runtime.submitPrompt("ありがとう、解決しました", createProviderSettings());
  assert.equal(initial.ok, true);

  const heartbeat = await runtime.runLiltobookHeartbeat({
    heartbeatMarkdown: "# HB\n会話履歴を見て再利用可能なら提案",
    providerSettings: createProviderSettings(),
    now: Date.now() + 61000
  });
  assert.equal(heartbeat.status, "proposed");
  assert.equal(prompts.some((p) => p.startsWith("/skill:liltobook")), true);

  const pendingNotice = await runtime.submitPrompt("次を進めて", createProviderSettings());
  assert.equal(pendingNotice.ok, true);
  assert.equal(pendingNotice.text.includes("再利用スキル候補"), true);

  const approved = await runtime.submitPrompt("はい", createProviderSettings());
  assert.equal(approved.ok, true);
  assert.equal(approved.text.includes("承認を受けてスキルを作成しました"), true);
  assert.equal(prompts.some((p) => p.startsWith("/skill:skill-creator")), true);
});

test("heartbeat 候補が既存スキルと重複する場合は作成しない", async () => {
  const prompts = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "手順を整理しました。" }
        });
        return () => {};
      },
      async prompt(text) {
        prompts.push(text);
      }
    }),
    availableSkills: [{ name: "liltobook" }, { name: "skill-creator" }],
    logger: { info() {}, error() {} }
  });

  const initial = await runtime.submitPrompt("ありがとう、解決しました", createProviderSettings());
  assert.equal(initial.ok, true);

  const heartbeat = await runtime.runLiltobookHeartbeat({
    heartbeatMarkdown: "# HB\n",
    providerSettings: createProviderSettings(),
    now: Date.now() + 61000
  });
  assert.equal(heartbeat.status, "proposed");

  const proposal = runtime["pendingHeartbeatProposal"];
  runtime["knownSkillNames"].add(proposal.skillName);

  const approved = await runtime.submitPrompt("はい", createProviderSettings());
  assert.equal(approved.ok, true);
  assert.equal(approved.text.includes("重複"), true);
  assert.equal(prompts.some((p) => p.startsWith("/skill:skill-creator")), false);
});

test("セッション実行中は heartbeat をスキップする", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe() {
        return () => {};
      },
      async prompt() {}
    }),
    availableSkills: [{ name: "liltobook" }, { name: "skill-creator" }],
    logger: { info() {}, error() {} }
  });

  const initial = await runtime.submitPrompt("ありがとう、解決しました", createProviderSettings());
  assert.equal(initial.ok, true);

  runtime["isSessionPromptActive"] = true;
  const heartbeat = await runtime.runLiltobookHeartbeat({
    heartbeatMarkdown: "# HB",
    providerSettings: createProviderSettings(),
    now: Date.now() + 61000
  });

  assert.equal(heartbeat.status, "skipped");
  assert.equal(heartbeat.reason, "agent_busy");
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

test("loop event 正規化: thinking_end の content を fallback で送出する", async () => {
  const loopEvents = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      subscribe(listener) {
        listener({ type: "thinking_start" });
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_end", content: "思考完了テキスト" }
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
    requestId: "req-think-fallback",
    onLoopEvent: (event) => {
      loopEvents.push(event);
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(loopEvents, [
    { type: "thinking_start", requestId: "req-think-fallback" },
    {
      type: "thinking_delta",
      requestId: "req-think-fallback",
      delta: "思考完了テキスト"
    },
    { type: "thinking_end", requestId: "req-think-fallback" }
  ]);
});
