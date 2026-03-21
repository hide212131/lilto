const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");

function startBridgeStub() {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/command") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        result: {
          content: [{ type: "text", text: "stub ok" }]
        }
      }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        requests,
        server,
        url: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function waitForJsonLine(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        return;
      }
      cleanup();
      resolve(JSON.parse(line));
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`cron-mcp-server exited early: ${code}`));
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

test("cron-mcp-server は Codex 互換の JSONL transport で initialize/tools を処理する", async (t) => {
  const bridge = await startBridgeStub();
  t.after(() => bridge.server.close());

  const child = spawn("/Users/hide/.nvm/versions/node/v22.14.0/bin/node", ["dist/main/cron-mcp-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LILTO_CRON_BRIDGE_URL: bridge.url,
      LILTO_CRON_BRIDGE_TOKEN: "test-token",
      LILTO_CRON_SESSION_ID: "session-live"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => child.kill());

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  })}\n`);
  const initializeResponse = await waitForJsonLine(child);
  assert.equal(initializeResponse.result.protocolVersion, "2025-06-18");
  assert.equal(initializeResponse.result.capabilities.tools.listChanged, true);

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  const toolsListResponse = await waitForJsonLine(child);
  assert.equal(toolsListResponse.result.tools[0].name, "cron");

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "cron",
      arguments: {
        operation: "list"
      }
    }
  })}\n`);
  const toolCallResponse = await waitForJsonLine(child);
  assert.equal(toolCallResponse.result.content[0].text, "stub ok");
  assert.equal(bridge.requests.length, 1);
  assert.equal(bridge.requests[0].sessionId, "session-live");
  assert.equal(bridge.requests[0].type, "cron.call");
});
