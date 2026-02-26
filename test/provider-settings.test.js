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

test("ProviderSettingsService は不正な networkProxy payload を拒否する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-provider-"));
  const storagePath = path.join(tempDir, "providers.json");

  const service = new ProviderSettingsService({
    storagePath,
    logger: { info() {}, error() {} }
  });

  const result = service.save({
    activeProvider: "custom-openai-completions",
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
