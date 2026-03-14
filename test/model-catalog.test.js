const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { ModelCatalogService } = require("../dist/main/model-catalog.js");

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

test("ModelCatalogService は OpenAI 互換 /models 応答を一覧へ変換する", async () => {
  const service = new ModelCatalogService({
    codexHomeDir: "/tmp/codex-home",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          data: [
            { id: "gpt-5.3-codex" },
            { id: "gpt-4.1-mini" }
          ]
        };
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.listCustomProviderModels(
    { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" },
    { useProxy: false }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.models.map((model) => model.id), ["gpt-4.1-mini", "gpt-5.3-codex"]);
});

test("ModelCatalogService は codex app-server の model/list を ChatGPT モデル一覧へ変換する", async () => {
  const service = new ModelCatalogService({
    codexHomeDir: "/tmp/codex-home",
    spawnImpl: () => createFakeChild((request, child) => {
      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: "2" } })}\n`);
        return;
      }
      if (request.method === "model/list") {
        child.stdout.write(`${JSON.stringify({
          id: request.id,
          result: {
            data: [
              { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
              { id: "gpt-5", displayName: "GPT-5" }
            ],
            nextCursor: null
          }
        })}\n`);
      }
    }),
    logger: { info() {}, error() {} }
  });

  const result = await service.listOauthModels("openai-codex", { useProxy: false });

  assert.equal(result.ok, true);
  assert.deepEqual(result.models, [
    { id: "gpt-5", displayName: "GPT-5" },
    { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" }
  ]);
});
