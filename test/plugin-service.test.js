const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const {
  CodexPluginService,
  resolvePluginCatalogSources,
  normalizePluginPoliciesForTest,
  readPluginInstallMetadataForTest,
  upsertPluginInstallMetadataRecordForTest
} = require("../dist/main/plugin-service.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function createFakeChild(onRequest) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", 0);
    return true;
  };

  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        onRequest(JSON.parse(line), child);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  return child;
}

test("resolvePluginCatalogSources は repo marketplace を source catalog として受け付ける", () => {
  const root = tempDir("plugin-marketplace");
  const marketplaceDir = path.join(root, ".agents", "plugins");
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(marketplaceDir, "marketplace.json"),
    JSON.stringify({
      name: "lilto-bundled",
      interface: { displayName: "Lilt-o Bundled" },
      plugins: [
        {
          name: "sample-plugin",
          source: {
            source: "local",
            path: "./plugins/sample-plugin"
          }
        }
      ]
    }, null, 2)
  );

  const result = resolvePluginCatalogSources({ workspaceDir: root });
  assert.deepEqual(result.localErrors, []);
  assert.deepEqual(result.cwds, [root]);
  assert.equal(result.bundledMarketplacePath, path.join(root, ".agents", "plugins", "marketplace.json"));
});

test("resolvePluginCatalogSources は ./ で始まらない plugin path を拒否する", () => {
  const root = tempDir("plugin-marketplace-invalid-prefix");
  const marketplaceDir = path.join(root, ".agents", "plugins");
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(marketplaceDir, "marketplace.json"),
    JSON.stringify({
      name: "lilto-bundled",
      plugins: [
        {
          name: "sample-plugin",
          source: {
            source: "local",
            path: "plugins/sample-plugin"
          }
        }
      ]
    }, null, 2)
  );

  const result = resolvePluginCatalogSources({ workspaceDir: root });
  assert.equal(result.cwds, undefined);
  assert.equal(result.localErrors.length, 1);
  assert.match(result.localErrors[0].message, /must start with `\.\/`/);
});

test("resolvePluginCatalogSources は marketplace root 外への path traversal を拒否する", () => {
  const root = tempDir("plugin-marketplace-invalid-containment");
  const marketplaceDir = path.join(root, ".agents", "plugins");
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(marketplaceDir, "marketplace.json"),
    JSON.stringify({
      name: "lilto-bundled",
      plugins: [
        {
          name: "sample-plugin",
          source: {
            source: "local",
            path: "./../escape"
          }
        }
      ]
    }, null, 2)
  );

  const result = resolvePluginCatalogSources({ workspaceDir: root });
  assert.equal(result.cwds, undefined);
  assert.equal(result.localErrors.length, 1);
  assert.match(result.localErrors[0].message, /must stay within the marketplace root/);
});

test("plugin install metadata は plugin id ごとに upsert できる", () => {
  const homeDir = tempDir("plugin-install-metadata");

  upsertPluginInstallMetadataRecordForTest(homeDir, {
    pluginId: "plugin://sample@lilto-bundled",
    pluginName: "sample",
    marketplaceName: "lilto-bundled",
    marketplacePath: "/tmp/marketplace.json",
    sourceKind: "bundled",
    installedVersion: null,
    installedAt: 100
  });
  upsertPluginInstallMetadataRecordForTest(homeDir, {
    pluginId: "plugin://sample@lilto-bundled",
    pluginName: "sample",
    marketplaceName: "lilto-bundled",
    marketplacePath: "/tmp/marketplace.json",
    sourceKind: "bundled",
    installedVersion: "1.0.0",
    installedAt: 200
  });

  assert.deepEqual(readPluginInstallMetadataForTest(homeDir), [
    {
      pluginId: "plugin://sample@lilto-bundled",
      pluginName: "sample",
      marketplaceName: "lilto-bundled",
      marketplacePath: "/tmp/marketplace.json",
      sourceKind: "bundled",
      installedVersion: "1.0.0",
      installedAt: 200
    }
  ]);
});

test("plugin policy 正規化は欠落フィールドを既定値へ補完する", () => {
  assert.deepEqual(
    normalizePluginPoliciesForTest({
      id: "gmail@openai-curated",
      name: "gmail",
      installed: false,
      enabled: false
    }),
    {
      installPolicy: "AVAILABLE",
      authPolicy: "ON_USE"
    }
  );

  assert.deepEqual(
    normalizePluginPoliciesForTest({
      id: "gmail@openai-curated",
      name: "gmail",
      installed: false,
      enabled: false,
      install_policy: "NOT_AVAILABLE",
      auth_policy: "ON_INSTALL"
    }),
    {
      installPolicy: "NOT_AVAILABLE",
      authPolicy: "ON_INSTALL"
    }
  );
});

test("installPlugin は plugin/read 非対応でも list/install だけで成功できる", async () => {
  const homeDir = tempDir("plugin-install");
  const workspaceDir = tempDir("plugin-workspace");
  let listCount = 0;

  const service = new CodexPluginService({
    workspaceDir,
    homeDir,
    codexHomeDir: path.join(homeDir, "codex"),
    codexCommand: "codex.cmd",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }

      if (request.method === "plugin/list") {
        listCount += 1;
        const installed = listCount > 1;
        child.stdout.write(`${JSON.stringify({
          id: request.id,
          result: {
            marketplaces: [
              {
                name: "openai-curated",
                path: "/tmp/marketplace.json",
                interface: { displayName: "openai-curated" },
                plugins: [
                  {
                    id: "gmail@openai-curated",
                    name: "gmail",
                    source: { type: "local", path: "/tmp/plugins/gmail" },
                    installed,
                    enabled: installed,
                    interface: null
                  }
                ]
              }
            ]
          }
        })}\n`);
        return;
      }

      if (request.method === "plugin/install") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`);
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.installPlugin({
    marketplacePath: "/tmp/marketplace.json",
    pluginName: "gmail",
    sourceKind: "official-curated"
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.installedPlugins.length, 1);
  assert.equal(result.state.installedPlugins[0].id, "gmail@openai-curated");
  assert.match(result.message, /gmail/);
});

test("installPlugin は app-server manifest error 時に local fallback で install できる", async () => {
  const homeDir = tempDir("plugin-install-fallback-home");
  const workspaceDir = tempDir("plugin-install-fallback-workspace");
  const sourceRoot = path.join(homeDir, ".tmp", "plugins", "plugins", "gmail");
  fs.mkdirSync(path.join(sourceRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "gmail" }));
  fs.writeFileSync(path.join(homeDir, ".tmp", "plugins.sha"), "sha-test\n");

  let listCount = 0;
  const service = new CodexPluginService({
    workspaceDir,
    homeDir,
    codexHomeDir: homeDir,
    codexCommand: "codex.cmd",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }

      if (request.method === "plugin/list") {
        listCount += 1;
        const installed = listCount > 1;
        child.stdout.write(`${JSON.stringify({
          id: request.id,
          result: {
            marketplaces: [
              {
                name: "openai-curated",
                path: path.join(homeDir, ".tmp", "plugins", ".agents", "plugins", "marketplace.json"),
                interface: { displayName: "openai-curated" },
                plugins: [
                  {
                    id: "gmail@openai-curated",
                    name: "gmail",
                    source: { type: "local", path: sourceRoot },
                    installed,
                    enabled: installed,
                    interface: null
                  }
                ]
              }
            ]
          }
        })}\n`);
        return;
      }

      if (request.method === "plugin/install") {
        child.stdout.write(`${JSON.stringify({ id: request.id, error: { message: `missing or invalid plugin manifest: ${path.join(sourceRoot, ".codex-plugin", "plugin.json")}` } })}\n`);
        return;
      }

      if (request.method === "config/value/write") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { status: "ok" } })}\n`);
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.installPlugin({
    marketplacePath: path.join(homeDir, ".tmp", "plugins", ".agents", "plugins", "marketplace.json"),
    pluginName: "gmail",
    sourceKind: "official-curated"
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.installedPlugins.length, 1);
  assert.ok(fs.existsSync(path.join(homeDir, "plugins", "cache", "openai-curated", "gmail", "sha-test", ".codex-plugin", "plugin.json")));
  assert.match(result.message, /gmail/);
});

test("listPlugins は local cache と config から installed/enabled を補完する", async () => {
  const homeDir = tempDir("plugin-list-local-state-home");
  const workspaceDir = tempDir("plugin-list-local-state-workspace");
  const installedRoot = path.join(homeDir, "plugins", "cache", "openai-curated", "gmail", "sha-test");
  fs.mkdirSync(path.join(installedRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(installedRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "gmail" }));
  fs.writeFileSync(path.join(homeDir, "config.toml"), '[plugins."gmail@openai-curated"]\nenabled = true\n');

  const service = new CodexPluginService({
    workspaceDir,
    homeDir,
    codexHomeDir: homeDir,
    codexCommand: "codex.cmd",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }

      if (request.method === "plugin/list") {
        child.stdout.write(`${JSON.stringify({
          id: request.id,
          result: {
            marketplaces: [
              {
                name: "openai-curated",
                path: "/tmp/marketplace.json",
                interface: { displayName: "openai-curated" },
                plugins: [
                  {
                    id: "gmail@openai-curated",
                    name: "gmail",
                    source: { type: "local", path: "/tmp/plugins/gmail" },
                    installed: false,
                    enabled: false,
                    interface: null
                  }
                ]
              }
            ]
          }
        })}\n`);
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.listPlugins();

  assert.equal(result.ok, true);
  assert.equal(result.state.marketplacePlugins[0].installed, true);
  assert.equal(result.state.marketplacePlugins[0].enabled, true);
});

test("readPlugin は app auth 情報を返す", async () => {
  const homeDir = tempDir("plugin-read-apps-home");
  const workspaceDir = tempDir("plugin-read-apps-workspace");

  const service = new CodexPluginService({
    workspaceDir,
    homeDir,
    codexHomeDir: homeDir,
    codexCommand: "codex.cmd",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }

      if (request.method === "plugin/read") {
        child.stdout.write(`${JSON.stringify({
          id: request.id,
          result: {
            plugin: {
              marketplaceName: "openai-curated",
              marketplacePath: "/tmp/marketplace.json",
              summary: {
                id: "gmail@openai-curated",
                name: "gmail",
                installed: true,
                enabled: true,
                interface: { displayName: "Gmail" }
              },
              description: "Read and manage Gmail",
              apps: [
                {
                  id: "gmail",
                  name: "Gmail",
                  description: "Gmail connector",
                  installUrl: "https://chatgpt.com/apps/gmail/gmail",
                  needsAuth: true
                }
              ]
            }
          }
        })}\n`);
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.readPlugin({ marketplacePath: "/tmp/marketplace.json", pluginName: "gmail" });

  assert.equal(result.ok, true);
  assert.equal(result.apps.length, 1);
  assert.equal(result.apps[0].installUrl, "https://chatgpt.com/apps/gmail/gmail");
  assert.equal(result.apps[0].needsAuth, true);
});