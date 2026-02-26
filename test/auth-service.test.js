const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ClaudeAuthService } = require("../dist/main/auth-service.js");

test("startOAuth は指定した oauth provider を使って認証する", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
  const authPath = path.join(tempDir, "auth.json");

  let requestedProvider = null;
  const service = new ClaudeAuthService({
    authPath,
    logger: { info() {}, error() {} },
    openExternal: async () => {},
    providerFactory: async (providerId) => {
      requestedProvider = providerId;
      return {
        login: async () => ({
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60_000
        })
      };
    }
  });

  const state = await service.startOAuth("openai-codex");
  assert.equal(requestedProvider, "openai-codex");
  assert.equal(state.phase, "authenticated");
  assert.equal(state.provider, "openai-codex");
});

test("未対応 provider の失敗メッセージに provider 名が含まれる", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
  const authPath = path.join(tempDir, "auth.json");

  const service = new ClaudeAuthService({
    authPath,
    logger: { info() {}, error() {} },
    openExternal: async () => {},
    providerFactory: async (providerId) => {
      throw new Error(`${providerId} OAuth provider が見つかりません`);
    }
  });

  const state = await service.startOAuth("google-antigravity");
  assert.equal(state.phase, "auth_failed");
  assert.match(state.message, /google-antigravity/);
});

test("旧形式（anthropic 単独）保存データを読み込める", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-auth-"));
  const authPath = path.join(tempDir, "auth.json");

  fs.writeFileSync(
    authPath,
    JSON.stringify({
      anthropic: {
        access: "legacy-access",
        refresh: "legacy-refresh",
        expires: Date.now() + 60_000
      }
    }),
    "utf8"
  );

  const service = new ClaudeAuthService({
    authPath,
    logger: { info() {}, error() {} },
    openExternal: async () => {},
    providerFactory: async () => {
      throw new Error("should not be called");
    }
  });

  const state = service.getState();
  assert.equal(state.phase, "authenticated");
  assert.equal(state.provider, "anthropic");
});
