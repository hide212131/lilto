const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { ModelCatalogService } = require("../dist/main/model-catalog.js");

const MODEL_ALPHA = "model-alpha";
const MODEL_BETA = "model-beta";

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
            { id: MODEL_BETA },
            { id: MODEL_ALPHA }
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
  assert.deepEqual(result.models.map((model) => model.id), [MODEL_ALPHA, MODEL_BETA]);
});

test("ModelCatalogService は codex app-server の model/list を ChatGPT モデル一覧へ変換する", async () => {
  const service = new ModelCatalogService({
    codexHomeDir: "/tmp/codex-home",
    codexCommand: "codex.cmd",
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
              { id: MODEL_BETA, displayName: "Model Beta" },
              { id: MODEL_ALPHA, displayName: "Model Alpha" }
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
    { id: MODEL_ALPHA, displayName: "Model Alpha" },
    { id: MODEL_BETA, displayName: "Model Beta" }
  ]);
});
