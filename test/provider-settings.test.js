const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ProviderSettingsService } = require("../dist/main/provider-settings.js");

test("ProviderSettingsService は保存した設定を再読込できる", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });

  const saveResult = service.save({
    activeProvider: "custom-openai-completions",
    oauthProvider: "openai-codex",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "my-custom",
      baseUrl: "https://example.com/v1",
      apiKey: "secret",
      modelId: "gpt-4o-mini"
    },
    networkProxy: {
      useProxy: true
    }
  });

  assert.equal(saveResult.ok, true);
  assert.equal(service.getState().activeProvider, "custom-openai-completions");

  const reloaded = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });

  const state = reloaded.getState();
  assert.equal(state.activeProvider, "custom-openai-completions");
  assert.equal(state.oauthProvider, "openai-codex");
  assert.equal(state.oauthModelId, "gpt-5.3-codex");
  assert.equal(state.customProvider.name, "my-custom");
  assert.equal(state.customProvider.baseUrl, "https://example.com/v1");
  assert.equal(state.networkProxy.useProxy, true);
});

test("ProviderSettingsService は不正 payload を拒否する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });

  const result = service.save({ activeProvider: "invalid" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_PROVIDER_SETTINGS");
});

test("ProviderSettingsService は不正な oauthProvider を拒否する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });

  const result = service.save({
    activeProvider: "oauth",
    oauthProvider: "invalid-provider",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "my-custom",
      baseUrl: "https://example.com/v1",
      apiKey: "secret",
      modelId: "gpt-4o-mini"
    },
    networkProxy: {
      useProxy: false
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_PROVIDER_SETTINGS");
});

test("ProviderSettingsService は不正な networkProxy payload を拒否する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });

  const result = service.save({
    activeProvider: "custom-openai-completions",
    oauthProvider: "anthropic",
    oauthModelId: "gpt-5.3-codex",
    customProvider: {
      name: "my-custom",
      baseUrl: "https://example.com/v1",
      apiKey: "secret",
      modelId: "gpt-4o-mini"
    },
    networkProxy: {
      useProxy: "yes"
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_PROVIDER_SETTINGS");
});

test("ProviderSettingsService は Proxy 環境変数がある場合 useProxy を既定で ON にする", () => {
  const prevHttpProxy = process.env.HTTP_PROXY;
  process.env.HTTP_PROXY = "http://proxy.local:8080";
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
    const storagePath = path.join(tempDir, "providers.json");
    const service = new ProviderSettingsService({
      storagePath,
      logger: { info() {}, error() {} }
    });
    assert.equal(service.getState().networkProxy.useProxy, true);
  } finally {
    if (prevHttpProxy === undefined) {
      delete process.env.HTTP_PROXY;
    } else {
      process.env.HTTP_PROXY = prevHttpProxy;
    }
  }
});

test("ProviderSettingsService は oauthProvider 未設定データを openai-codex へ補完する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");
  fs.writeFileSync(
    storagePath,
    JSON.stringify({
      activeProvider: "oauth",
      oauthModelId: "legacy-model",
      customProvider: {
        name: "legacy",
        baseUrl: "https://legacy.example/v1",
        apiKey: "",
        modelId: "legacy-model"
      },
      networkProxy: {
        useProxy: false
      },
      updatedAt: 123
    }),
    "utf8"
  );

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });
  const state = service.getState();
  assert.equal(state.oauthProvider, "openai-codex");
  assert.equal(state.oauthModelId, "legacy-model");
});

test("ProviderSettingsService は modelId 未設定データを gpt-5.3-codex へ補完する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");
  fs.writeFileSync(
    storagePath,
    JSON.stringify({
      activeProvider: "oauth",
      oauthProvider: "openai-codex",
      oauthModelId: "",
      customProvider: {
        name: "legacy",
        baseUrl: "",
        apiKey: "",
        modelId: ""
      },
      networkProxy: {
        useProxy: false
      },
      updatedAt: 123
    }),
    "utf8"
  );

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });
  const state = service.getState();
  assert.equal(state.oauthModelId, "gpt-5.3-codex");
  assert.equal(state.customProvider.modelId, "gpt-5.3-codex");
});

test("ProviderSettingsService は oauth モードの legacy qwen modelId を gpt-5.3-codex へ移行する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");
  fs.writeFileSync(
    storagePath,
    JSON.stringify({
      activeProvider: "oauth",
      oauthProvider: "openai-codex",
      oauthModelId: "qwen2.5:0.5b",
      customProvider: {
        name: "legacy",
        baseUrl: "",
        apiKey: "",
        modelId: "qwen2.5:0.5b"
      },
      networkProxy: {
        useProxy: false
      },
      updatedAt: 123
    }),
    "utf8"
  );

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });
  const state = service.getState();
  assert.equal(state.oauthModelId, "gpt-5.3-codex");
  assert.equal(state.customProvider.modelId, "qwen2.5:0.5b");
});
