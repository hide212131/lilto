const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { AgentRuntime } = require("../dist/main/agent-sdk.js");

function createProviderSettings(overrides = {}) {
  return {
    activeProvider: "oauth",
    oauthProvider: "openai-codex",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "OpenAI API Key",
      baseUrl: "",
      apiKey: "",
      modelId: "gpt-5.3-codex"
    },
    networkProxy: {
      useProxy: false
    },
    windowsSandbox: {
      mode: "off",
      privateDesktop: true
    },
    chatSettings: {
      enterToSend: false,
      globalShortcut: "CommandOrControl+L"
    },
    updatedAt: Date.now(),
    ...overrides
  };
}

function createAuthService(phase = "authenticated") {
  return {
    getState() {
      return { phase, provider: "openai-codex" };
    },
    async getApiKey() {
      return null;
    }
  };
}

test("ChatGPT 認証済みなら Codex thread event を text_delta と session_bound に正規化する", async () => {
  const events = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      id: null,
      async runStreamed() {
        async function* stream() {
          yield { type: "thread.started", thread_id: "thread-1" };
          yield { type: "item.started", item: { id: "r1", type: "reasoning", text: "考え中" } };
          yield { type: "item.completed", item: { id: "r1", type: "reasoning", text: "考え中" } };
          yield { type: "item.updated", item: { id: "m1", type: "agent_message", text: "hello" } };
          yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "hello world" } };
        }
        return { events: stream() };
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test", createProviderSettings(), {
    requestId: "req-1",
    conversationId: "conv-1",
    onLoopEvent: (event) => events.push(event)
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "hello world");
  assert.deepEqual(events[0], {
    type: "session_bound",
    requestId: "req-1",
    conversationId: "conv-1",
    agentSessionId: "thread-1"
  });
  assert.ok(events.some((event) => event.type === "thinking_start"));
  assert.ok(events.some((event) => event.type === "thinking_end"));
  assert.ok(events.some((event) => event.type === "text_delta" && event.delta === "hello"));
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

test("API key モードでは保存済み API key と model/baseUrl を使う", async () => {
  let receivedOptions = null;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      receivedOptions = options;
      return {
        id: "thread-api-key",
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      activeProvider: "custom-openai-completions",
      customProvider: {
        name: "OpenAI API Key",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelId: "gpt-5.3-codex"
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, "done");
  assert.equal(receivedOptions.apiKey, "sk-test");
  assert.equal(receivedOptions.model.id, "gpt-5.3-codex");
  assert.equal(receivedOptions.model.baseUrl, "https://example.com/v1");
});

test("ChatGPT 認証モードでも保存済み modelId を使う", async () => {
  let receivedOptions = null;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      receivedOptions = options;
      return {
        id: "thread-oauth",
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      customProvider: {
        name: "OpenAI API Key",
        baseUrl: "",
        apiKey: "",
        modelId: "gpt-5.3-codex"
      },
      oauthModelId: "gpt-5.3-codex"
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, "done");
  assert.equal(receivedOptions.apiKey, null);
  assert.equal(receivedOptions.model.id, "gpt-5.3-codex");
});

test("ChatGPT 認証モードでは legacy qwen modelId を gpt-5.3-codex へ矯正する", async () => {
  let receivedOptions = null;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      receivedOptions = options;
      return {
        id: "thread-oauth",
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      customProvider: {
        name: "OpenAI API Key",
        baseUrl: "",
        apiKey: "",
        modelId: "qwen2.5:0.5b"
      },
      oauthModelId: "qwen2.5:0.5b"
    })
  );

  assert.equal(result.ok, true);
  assert.equal(receivedOptions.model.id, "gpt-5.3-codex");
});

test("同じ conversationId は thread.started 後の session を再利用する", async () => {
  const calls = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    codexHomeDir: "/tmp/codex-home",
    schedulerBridge: {
      getBridgeEnv(sessionId) {
        return { LILTO_CRON_SESSION_ID: sessionId };
      }
    },
    createSession: async (options) => {
      calls.push(options);
      const threadId = options.threadId || null;
      return {
        id: threadId,
        async runStreamed() {
          async function* stream() {
            if (!threadId) {
              yield { type: "thread.started", thread_id: "thread-reused" };
            }
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "ok" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  await runtime.submitPrompt("first", createProviderSettings(), { requestId: "req-1", conversationId: "conv-1" });
  await runtime.submitPrompt("second", createProviderSettings(), { requestId: "req-2", conversationId: "conv-1" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].threadId, undefined);
  assert.equal(calls[0].codexHomeDir, "/tmp/codex-home");
  assert.equal(calls[0].schedulerSessionId, "conv-1");
});

test("backendSessionId が渡されれば再起動後でも既存 thread を resume する", async () => {
  const calls = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      calls.push(options);
      return {
        id: options.threadId || null,
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "resumed" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("again", createProviderSettings(), {
    requestId: "req-1",
    conversationId: "conv-1",
    backendSessionId: "thread-restored-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "resumed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].threadId, "thread-restored-1");
  assert.equal(calls[0].schedulerSessionId, "thread-restored-1");
});

test("refreshPlugins 後は次回送信で session を再作成する", async () => {
  let sessionCount = 0;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => {
      sessionCount += 1;
      return {
        id: `thread-${sessionCount}`,
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  await runtime.submitPrompt("first", createProviderSettings(), { requestId: "req-1", conversationId: "conv-1" });
  runtime.refreshPlugins();
  await runtime.submitPrompt("second", createProviderSettings(), { requestId: "req-2", conversationId: "conv-1" });

  assert.equal(sessionCount, 2);
});

test("タイマー依頼は cron 使用ルールを内部 prompt に補強する", async () => {
  let receivedInput = null;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      id: "thread-scheduler",
      async runStreamed(input) {
        receivedInput = input;
        async function* stream() {
          yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
        }
        return { events: stream() };
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("30秒後におしえて", createProviderSettings());

  assert.equal(result.ok, true);
  assert.match(receivedInput, /30秒後におしえて/);
  assert.match(receivedInput, /MUST use the `cron` MCP tool/);
  assert.match(receivedInput, /Never use sleep/);
});

test("scheduler follow-up prompt には cron 強制ルールを再注入しない", async () => {
  let receivedInput = null;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      id: "thread-follow-up",
      async runStreamed(input) {
        receivedInput = input;
        async function* stream() {
          yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
        }
        return { events: stream() };
      }
    }),
    logger: { info() {}, error() {} }
  });

  const followUpPrompt = [
    "以下はこの会話で発火した scheduler 通知です。",
    "通知文言: 30秒経過しました。",
    "続きの処理: alpha.co.jp を開く"
  ].join("\n");

  const result = await runtime.submitPrompt(followUpPrompt, createProviderSettings());

  assert.equal(result.ok, true);
  assert.equal(receivedInput, followUpPrompt);
});

test("proxy precheck 失敗は PROXY_CONNECTION_FAILED に正規化する", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("proxy required");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  process.env.LILTO_E2E_MOCK = "1";
  process.env.LILTO_PROXY_TEST_URL = `http://127.0.0.1:${port}/proxy-check`;

  try {
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
        activeProvider: "custom-openai-completions",
        customProvider: {
          name: "OpenAI API Key",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-test",
          modelId: "gpt-5.3-codex"
        },
        networkProxy: {
          useProxy: false
        }
      })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PROXY_CONNECTION_FAILED");
  } finally {
    delete process.env.LILTO_E2E_MOCK;
    delete process.env.LILTO_PROXY_TEST_URL;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Windows sandbox 有効時は workspace-write と Codex config override を渡す", async () => {
  let receivedOptions = null;
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    platform: "win32",
    createSession: async (options) => {
      receivedOptions = options;
      return {
        id: "thread-windows-sandbox",
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      windowsSandbox: {
        mode: "elevated",
        privateDesktop: false
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(receivedOptions.sandboxMode, "workspace-write");
  assert.deepEqual(receivedOptions.config, {
    windows: {
      sandbox: "elevated",
      sandbox_private_desktop: false
    }
  });
});

test("Windows sandbox setup required エラーを標準化する", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    platform: "win32",
    createSession: async () => ({
      id: null,
      async runStreamed() {
        async function* stream() {
          yield {
            type: "item.completed",
            item: {
              id: "err-1",
              type: "error",
              error: { message: "sandbox setup required: rerun the sandbox setup" }
            }
          };
        }
        return { events: stream() };
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt(
    "test",
    createProviderSettings({
      windowsSandbox: {
        mode: "unelevated",
        privateDesktop: true
      }
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "WINDOWS_SANDBOX_SETUP_REQUIRED");
});

test("refreshProviderSettings は既存 session cache を破棄する", async () => {
  const calls = [];
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async (options) => {
      calls.push(options);
      return {
        id: null,
        async runStreamed() {
          async function* stream() {
            yield { type: "item.completed", item: { id: "m1", type: "agent_message", text: "done" } };
          }
          return { events: stream() };
        }
      };
    },
    logger: { info() {}, error() {} }
  });

  await runtime.submitPrompt("first", createProviderSettings());
  runtime.refreshProviderSettings();
  await runtime.submitPrompt("second", createProviderSettings());

  assert.equal(calls.length, 2);
});

test("item.completed の error item は失敗として返す", async () => {
  const runtime = new AgentRuntime({
    authService: createAuthService("authenticated"),
    createSession: async () => ({
      id: null,
      async runStreamed() {
        async function* stream() {
          yield { type: "thread.started", thread_id: "thread-1" };
          yield {
            type: "item.completed",
            item: {
              id: "err-1",
              type: "error",
              error: { code: "tool_error", message: "scheduler bridge unavailable" }
            }
          };
        }
        return { events: stream() };
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await runtime.submitPrompt("test", createProviderSettings(), {
    requestId: "req-1",
    conversationId: "conv-1"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AGENT_EXECUTION_FAILED");
  assert.match(result.error.message, /scheduler bridge unavailable/);
});
