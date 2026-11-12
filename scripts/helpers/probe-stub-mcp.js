/**
 * Minimal stdio MCP server standing in for lilto_browser in App Server instruction probes.
 * Exposes the same tool names as the real server (16, or 17 with browser_evaluate) so the model
 * input's tool definitions can be compared. Calls are served from a local test page and logged
 * server-side (User-Agent "lilto-stub"), which is the ground truth for "the lilto_browser route was used".
 *
 *   PROBE_STUB_TOOLS=16|17  PROBE_PAGE_BASE=http://127.0.0.1:PORT
 */
const http = require("node:http");
const readline = require("node:readline");

const base = process.env.PROBE_PAGE_BASE || "";
const names = ["browser_status", "browser_acquire", "browser_release", "browser_navigate", "browser_back", "browser_forward", "browser_reload", "browser_snapshot", "browser_click", "browser_fill", "browser_select", "browser_press", "browser_scroll", "browser_get_text", "browser_screenshot", "browser_wait"];
if (process.env.PROBE_STUB_TOOLS === "17") names.push("browser_evaluate");
const tools = names.map((name) => ({ name, description: `stub ${name} (probe)`, inputSchema: { type: "object", properties: { url: { type: "string" }, leaseId: { type: "string" }, ref: { type: "string" }, snapshotId: { type: "string" }, script: { type: "string" } }, additionalProperties: true } }));

const get = (path) => new Promise((resolve, reject) => {
  http.get(base + path, { headers: { "user-agent": "lilto-stub" } }, (res) => { let b = ""; res.on("data", (c) => { b += c; }); res.on("end", () => resolve(b)); }).on("error", reject);
});
let page = "";
async function call(name, args) {
  if (name === "browser_status") return { ok: true, result: { enabled: true, available: true, owner: "none" } };
  if (name === "browser_acquire" || name === "browser_navigate") {
    const u = new URL(args.url);
    page = await get(u.pathname + u.search);
    return { ok: true, result: { leaseId: "stub-lease", finalUrl: args.url }, text: page };
  }
  if (name === "browser_snapshot" || name === "browser_get_text") return { ok: true, result: { snapshotId: "snap-1", nodes: [{ ref: "e1", role: "button", name: "Confirm" }], text: page } };
  if (name === "browser_click") { const after = await get("/confirm?via=lilto_browser_click"); return { ok: true, result: { dispatched: true, pageAfter: after } }; }
  if (name === "browser_evaluate") { await get("/confirm?via=lilto_browser_evaluate"); return { ok: true, result: { value: "done" } }; }
  return { ok: true, result: {} };
}

const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
rl.on("line", async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  if (msg.method === "initialize") return send({ id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lilto_browser_stub", version: "0" } } });
  if (msg.method === "tools/list") return send({ id: msg.id, result: { tools } });
  if (msg.method === "tools/call") {
    try { const r = await call(msg.params.name, msg.params.arguments || {}); return send({ id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r } }); }
    catch (e) { return send({ id: msg.id, result: { isError: true, content: [{ type: "text", text: String(e) }] } }); }
  }
  send({ id: msg.id, result: {} });
});
