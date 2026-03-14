const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("agent runtime は Codex config で cron MCP server を注入する", () => {
  const content = fs.readFileSync("src/main/agent-sdk.ts", "utf8");
  assert.match(content, /mcp_servers/);
  assert.match(content, /cron-mcp-server\.js/);
  assert.match(content, /getBridgeEnv/);
});

test("cron MCP server は tools\\/list と tools\\/call を実装する", () => {
  const content = fs.readFileSync("src/main/cron-mcp-server.ts", "utf8");
  assert.match(content, /case "tools\/list"/);
  assert.match(content, /case "tools\/call"/);
  assert.match(content, /LILTO_CRON_BRIDGE_URL/);
});
