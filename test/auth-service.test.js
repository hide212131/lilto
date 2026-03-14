const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ClaudeAuthService } = require("../dist/main/auth-service.js");

test("chatgpt token を含む auth.json がある場合は ChatGPT 認証済みとして初期化される", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
  const codexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "x" } }),
    "utf8"
  );

  const service = new ClaudeAuthService({
    authPath: path.join(tempDir, "auth.json"),
    codexHome,
    fallbackCodexHome: path.join(tempDir, "unused-fallback"),
    logger: { info() {}, error() {} }
  });

  const state = service.getState();
  assert.equal(state.phase, "authenticated");
  assert.equal(state.provider, "openai-codex");
  assert.equal(state.debug.authMode, "chatgpt");
  assert.equal(state.debug.hasAccessToken, true);
  assert.equal(state.debug.isChatGptAuthenticated, true);
});

test("API key だけの auth.json では ChatGPT 認証済みにしない", () => {
  const previousMock = process.env.LILTO_E2E_MOCK;
  delete process.env.LILTO_E2E_MOCK;
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
    const codexHome = path.join(tempDir, ".codex");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "auth.json"),
      JSON.stringify({ auth_mode: "api_key", OPENAI_API_KEY: "sk-test" }),
      "utf8"
    );

    const service = new ClaudeAuthService({
      authPath: path.join(tempDir, "auth.json"),
      codexHome,
      fallbackCodexHome: path.join(tempDir, "unused-fallback"),
      logger: { info() {}, error() {} }
    });

    const state = service.getState();
    assert.equal(state.phase, "unauthenticated");
    assert.equal(state.debug.authMode, "api_key");
    assert.equal(state.debug.hasOpenAiApiKey, true);
    assert.equal(state.debug.isChatGptAuthenticated, false);
  } finally {
    if (previousMock === undefined) {
      delete process.env.LILTO_E2E_MOCK;
    } else {
      process.env.LILTO_E2E_MOCK = previousMock;
    }
  }
});

test("legacy ~/.codex の ChatGPT auth を app 用 CODEX_HOME へ移行する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
  const primaryCodexHome = path.join(tempDir, "app-codex");
  const fallbackCodexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(fallbackCodexHome, { recursive: true });
  fs.writeFileSync(
    path.join(fallbackCodexHome, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { refresh_token: "refresh-token" } }),
    "utf8"
  );

  const service = new ClaudeAuthService({
    authPath: path.join(tempDir, "auth.json"),
    codexHome: primaryCodexHome,
    fallbackCodexHome,
    logger: { info() {}, error() {} }
  });

  const state = service.getState();
  assert.equal(state.phase, "authenticated");
  assert.equal(state.debug.authSourcePath, path.join(primaryCodexHome, "auth.json"));
  assert.equal(fs.existsSync(path.join(primaryCodexHome, "auth.json")), true);
});

test("API key を保存すると getApiKey で復元できる", async () => {
  const previousMock = process.env.LILTO_E2E_MOCK;
  delete process.env.LILTO_E2E_MOCK;
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
    const service = new ClaudeAuthService({
      authPath: path.join(tempDir, "auth.json"),
      codexHome: path.join(tempDir, ".codex"),
      fallbackCodexHome: path.join(tempDir, "unused-fallback"),
      logger: { info() {}, error() {} }
    });

    service.setApiKey("sk-test");
    assert.equal(await service.getApiKey("openai-codex"), "sk-test");
    assert.equal(service.getState().debug.hasStoredApiKey, true);
  } finally {
    if (previousMock === undefined) {
      delete process.env.LILTO_E2E_MOCK;
    } else {
      process.env.LILTO_E2E_MOCK = previousMock;
    }
  }
});
