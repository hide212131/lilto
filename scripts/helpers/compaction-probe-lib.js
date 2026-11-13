/**
 * Shared pieces for the compaction / restart-retention probes (issue #43 redesign, task 1).
 * Self-contained JSON-RPC client that timestamps every line it receives (monotonic ms), and a recording
 * Responses server that stamps every model request on the same clock, so notification / model-request
 * ordering can be established. Reuses texts and rollout helpers from app-server-instruction-probe.js.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const base = require("./app-server-instruction-probe.js");

const t0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - t0) / 1e6;
const { BIN } = base;

class Rpc {
  constructor({ home, timeline, label, env }) { Object.assign(this, { home, timeline, label, extraEnv: env ?? {}, nextId: 1, pending: new Map(), notes: [], waiters: [], serverRequests: [], stderr: [] }); }
  async start() {
    const env = { ...process.env, ...this.extraEnv, CODEX_HOME: this.home };
    delete env.CODEX_THREAD_ID; delete env.CODEX_SANDBOX_NETWORK_DISABLED;
    this.child = spawn(BIN, ["app-server", "--listen", "stdio://"], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.pid = this.child.pid;
    this.child.stderr.on("data", (c) => { this.stderr.push(String(c)); if (this.stderr.length > 200) this.stderr.shift(); });
    this.exited = new Promise((r) => this.child.once("exit", (code, sig) => r({ code, sig })));
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (l) => this.onLine(l));
    await this.request("initialize", { clientInfo: { name: "lilto-probe", title: "probe", version: "0" }, capabilities: { experimentalApi: true } });
    this.send({ method: "initialized", params: {} });
  }
  send(m) { this.child.stdin.write(JSON.stringify(m) + "\n"); }
  onLine(l) {
    let m; try { m = JSON.parse(l); } catch { return; }
    const t = now();
    if (m.id !== undefined && m.method === undefined) {
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.to);
      if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`)); else p.res(m.result); return;
    }
    if (m.id !== undefined && m.method) { // server -> client request: record and reply with an empty/declined result
      this.serverRequests.push({ t, method: m.method, params: m.params });
      this.timeline.push({ t, src: "rpc", proc: this.label, kind: "serverRequest", method: m.method });
      this.send({ id: m.id, result: {} }); return;
    }
    const rec = { t, method: m.method, params: m.params };
    this.notes.push(rec);
    this.timeline.push({ t, src: "rpc", proc: this.label, kind: "notification", method: m.method, itemType: m.params?.item?.type, turnId: m.params?.turnId ?? m.params?.turn?.id });
    for (const w of [...this.waiters]) if (w.pred(rec)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(rec); }
  }
  request(method, params, ms = 60000) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.pending.delete(id); rej(new Error(`timeout ${method}`)); }, ms);
      this.pending.set(id, { res, rej, to, method });
      this.timeline.push({ t: now(), src: "rpc", proc: this.label, kind: "request", method });
      this.send({ id, method, params });
    });
  }
  /** Resolve when a notification matching pred has arrived (already-received ones count when `from` index given). */
  waitNote(pred, ms = 120000, from = 0) {
    const hit = this.notes.slice(from).find(pred); if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("waitNote timeout")), ms); this.waiters.push({ pred, res: (r) => { clearTimeout(to); res(r); } }); });
  }
  async kill() { try { this.rl.close(); } catch { /* */ } if (this.child && this.child.exitCode === null) { this.child.kill("SIGKILL"); } await this.exited; }
}

/**
 * Recording Responses server. `behavior(req, n)` may return {usage, text, delayMs, hold}. Each request is classified:
 *   compaction  - input's last item (or instructions) carries the local-compaction prompt
 *   normal      - anything else
 */
function startRecorder(timeline, opts = {}) {
  const requests = []; let n = 0;
  const state = { usageTokens: 1, delayMs: 0, holdNext: null, onRequest: null, ...opts };
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const t = now();
      if (!req.url.includes("/responses")) { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      let json = null; try { json = JSON.parse(body); } catch { /* */ }
      n += 1;
      const seq = n;
      const input = Array.isArray(json?.input) ? json.input : [];
      const flat = (it) => Array.isArray(it.content) ? it.content.map((c) => c.text ?? "").join("\n") : typeof it.content === "string" ? it.content : "";
      const last = input[input.length - 1] ?? {};
      const isCompaction = /CONTEXT CHECKPOINT COMPACTION|checkpoint compaction|summary for another LLM|handoff summary/i.test(flat(last)) || /\/compact/.test(req.url);
      const rec = { seq, t, url: req.url, headers: { session_id: req.headers["session_id"], "x-codex-turn-metadata": req.headers["x-codex-turn-metadata"] ? String(req.headers["x-codex-turn-metadata"]).slice(0, 400) : undefined }, kind: isCompaction ? "compaction" : "normal", body: json };
      requests.push(rec);
      timeline.push({ t, src: "model", seq, kind: rec.kind, url: req.url, inputItems: input.length });
      if (state.onRequest) state.onRequest(rec);
      if (state.holdNext && !isCompaction) { const h = state.holdNext; state.holdNext = null; await h(rec); }
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (isCompaction && state.compactionDelayMs) await new Promise((r) => setTimeout(r, state.compactionDelayMs));
      const id = `resp_${n}`;
      const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      const text = isCompaction ? `SUMMARY-${n}: the user ran several pings; assistant answered ok. (probe summary)` : `ok-${n}`;
      if (/\/compact/.test(req.url)) { // remote-compaction style endpoint: return a compacted output
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ output: [{ type: "message", role: "user", content: [{ type: "input_text", text: "remote-compacted-probe" }] }, { type: "compaction", encrypted_content: "probe" }] }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse("response.created", { type: "response.created", response: { id } }));
      const scripted = !isCompaction && state.script ? state.script(rec) : null; // {toolCall:{name,args}} | {text}
      const item = scripted?.toolCall
        ? { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: scripted.toolCall.name, arguments: JSON.stringify(scripted.toolCall.args) }
        : { type: "message", role: "assistant", id: `msg_${n}`, content: [{ type: "output_text", text: scripted?.text ?? text }] };
      rec.responded = scripted?.toolCall ? "function_call" : "message";
      res.write(sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: item.type === "message" ? { ...item, content: [] } : item }));
      res.write(sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item }));
      const u = state.usageTokens;
      res.end(sse("response.completed", { type: "response.completed", response: { id, usage: { input_tokens: u, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: u + 1 } } }));
      timeline.push({ t: now(), src: "model", seq, kind: "response-completed", reqKind: rec.kind });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, state, port: server.address().port, close: () => server.close() })));
}

function makeHome(port, extraToml = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-cprobe-home-"));
  const lines = [`model = "${process.env.PROBE_MODEL || "probe-model"}"`, 'model_provider = "probe"', ...extraToml, "", "[model_providers.probe]", 'name = "probe"', `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"', "supports_websockets = false", "requires_openai_auth = false"];
  fs.writeFileSync(path.join(home, "config.toml"), lines.join("\n") + "\n");
  return home;
}

// ---------------------------------------------------------------- design section 6 full texts (state = browser/evaluate)
const MARK = base.markersIn ? (id) => `[probe-marker:${id}]` : null;
const HEADER = "[Lilto embedded-browser state update]\nThis is lilto's current embedded-browser state for this thread. It remains in effect for subsequent turns until a later lilto-provided embedded-browser state update supersedes it. This update supersedes all earlier lilto-provided embedded-browser mode and browser_evaluate instructions, including earlier ON and OFF updates. It does not override unrelated instructions or permissions. Do not announce this state unless it is relevant to the user's request.";
function designText(state) { // state: "OFF" | "ON" | "ON_EVAL"
  if (state === "OFF") return [HEADER, "Current state: embedded-browser integration OFF; browser_evaluate unavailable.", "Lilto's embedded-browser integration is disabled. All earlier lilto-specific requirements to use lilto_browser and prohibitions on external Chromium/Chrome, the agent-browser CLI, other Playwright browsers, or other browser automation routes are withdrawn. Those restrictions must not be used as a reason to refuse browser work.", "The lilto_browser tools are unavailable: do not call them or reuse earlier browser leases, refs, frameIds, or documentEpoch values. For browser tasks, use the normally available tools or skills, subject to all other applicable instructions and permissions. If those means are unavailable, explain the actual limitation. A later lilto-provided ON update restores the embedded-browser-only policy.", MARK("D_OFF")].join("\n");
  const ev = state === "ON_EVAL";
  const old = require(require("node:path").join(base.root ?? require("node:path").resolve(__dirname, "..", ".."), "dist/main/agent-sdk-config.js")).browserDeveloperInstructions({ evaluateEnabled: ev }).split("\n");
  const rules = old.filter((l) => l !== "[Embedded browser]" && !l.startsWith("Use the `lilto_browser` MCP tools for every") && !l.startsWith("Do not start an external Chromium"));
  return [HEADER, `Current state: embedded-browser integration ON; browser_evaluate ${ev ? "ON" : "OFF"}.`, "For every browser task while this state is in effect, use only the lilto_browser MCP tools. Do not launch, connect to, or use external Chromium/Chrome, the agent-browser CLI, another Playwright browser, or another browser automation route as a fallback.", "Missing tools, discovery failures, capability failures, or browser errors do not change this state to OFF. Stop the browser work and explain the limitation instead of using an external route. This ON update supersedes earlier OFF permissions to use normal external browser means.", ...(ev ? [] : ["browser_evaluate is disabled and unavailable. Earlier instructions describing it do not authorize its use. Do not call it. For unsupported operations, ask the user to perform them in the panel; do not use another browser as a workaround."]), ...rules, MARK(ev ? "D_ON_EVAL" : "D_ON")].join("\n");
}
const DESIGN_IDS = ["D_OFF", "D_ON_EVAL", "D_ON", "OLD_ON"];
const DESIGN_ID_OF = { OFF: "D_OFF", ON: "D_ON", ON_EVAL: "D_ON_EVAL" };
const itemText = (it) => Array.isArray(it.content) ? it.content.map((c) => c.text ?? c.encrypted_content ?? "").join("\n") : typeof it.content === "string" ? it.content : it.type === "compaction" || it.type === "compaction_summary" ? "<compaction item>" : "";
/**
 * Structural scan of one model request: per input item role/type and which design state texts it carries
 * (id = marker present; complete = every non-empty line of the full text is present in that single item).
 */
function inspectInput(body, texts) {
  const input = Array.isArray(body?.input) ? body.input : [];
  const items = input.map((it, idx) => {
    const text = itemText(it);
    const states = DESIGN_IDS.filter((id) => text.includes(`[probe-marker:${id}]`)).map((id) => {
      const full = texts[id];
      const complete = full ? full.split("\n").filter(Boolean).every((l) => text.includes(l)) : null;
      return { id, complete };
    });
    return { idx, type: it.type, role: it.role, len: text.length, states, head: text.slice(0, 70).replace(/\n/g, "\\n") };
  });
  const stateItems = items.filter((i) => i.states.length);
  const devStates = stateItems.filter((i) => i.role === "developer");
  const latest = devStates[devStates.length - 1];
  return { nItems: items.length, roles: items.map((i) => `${i.type}/${i.role ?? ""}`), items, stateItems: stateItems.map((i) => ({ idx: i.idx, role: i.role, type: i.type, states: i.states })), devStateCount: devStates.length, latestDeveloperState: latest ? { idx: latest.idx, ...latest.states[latest.states.length - 1] } : null, nonDeveloperStateMentions: stateItems.filter((i) => i.role !== "developer").map((i) => ({ idx: i.idx, role: i.role, type: i.type, ids: i.states.map((x) => x.id) })), hasCompactionItem: items.some((i) => i.type === "compaction" || i.type === "compaction_summary") };
}
const allTexts = () => ({ D_OFF: designText("OFF"), D_ON: designText("ON"), D_ON_EVAL: designText("ON_EVAL"), OLD_ON: base.oldOnText(false) });
const ctx = (text, key = "lilto_browser_state") => ({ additionalContext: { [key]: { kind: "application", value: text } } });

module.exports = { withBrowserMcpConfig: require(path.join(path.resolve(__dirname, "..", ".."), "dist/main/agent-sdk-config.js")).withBrowserMcpConfig, designText, inspectInput, allTexts, ctx, DESIGN_ID_OF, DESIGN_IDS, ...base, Rpc, now, startRecorder, makeHome };

// ---------------------------------------------------------------- recording forwarding proxy (real provider path)
/**
 * Plain-HTTP forwarding proxy in front of the real ChatGPT backend so the real model request bodies (and the remote
 * compaction endpoint) can be recorded. Codex is pointed at it through `chatgpt_base_url`. Request bodies may be
 * zstd-compressed; they are decoded with the `zstd` CLI. Authorization headers are never stored.
 */
function startProxy(timeline, { upstream = "https://chatgpt.com" } = {}) {
  const https = require("node:https");
  
  const requests = []; let n = 0; const state = { onRequest: null, upgrades: [] };
  // async decode with a timeout: a synchronous spawn here once blocked the whole event loop (hung zstd child)
  const unzstd = (buf) => new Promise((resolve, reject) => { const c = spawn("zstd", ["-d", "-c"]); const out = []; const to = setTimeout(() => { c.kill("SIGKILL"); reject(new Error("zstd timeout")); }, 10000); c.stdout.on("data", (d) => out.push(d)); c.on("error", reject); c.on("close", (code) => { clearTimeout(to); code === 0 ? resolve(Buffer.concat(out)) : reject(new Error("zstd exit " + code)); }); c.stdin.on("error", () => {}); c.stdin.end(buf); });
  const server = http.createServer((req, res) => {
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const t = now(); const raw = Buffer.concat(chunks); n += 1; const seq = n;
      let bodyBuf = raw; const enc = String(req.headers["content-encoding"] || "");
      if (enc.includes("zstd") && raw.length) bodyBuf = await unzstd(raw).catch(() => raw);
      let json = null; try { json = JSON.parse(bodyBuf.toString("utf8")); } catch { /* not json */ }
      const isModel = /\/responses(\?|$)/.test(req.url) && req.method === "POST";
      const isCompact = /\/responses\/compact/.test(req.url);
      const input = Array.isArray(json?.input) ? json.input : [];
      const flat = (it) => Array.isArray(it.content) ? it.content.map((c) => c.text ?? "").join("\n") : typeof it.content === "string" ? it.content : "";
      const kind = isCompact ? "compaction-remote" : isModel ? (input.some((it) => it.type === "compaction_trigger") || /CONTEXT CHECKPOINT COMPACTION/i.test(flat(input[input.length - 1] ?? {})) ? "compaction" : "normal") : "other";
      if (process.env.PROXY_DEBUG) console.error("PROXY", req.method, req.url, enc);
      const rec = { seq, t, method: req.method, url: req.url, kind, body: kind === "other" ? undefined : json, responseText: "", status: null };
      if (kind !== "other") { requests.push(rec); timeline.push({ t, src: "model", seq, kind, url: req.url, inputItems: input.length }); if (state.onRequest) state.onRequest(rec); }
      const headers = { ...req.headers }; delete headers.host; delete headers["content-length"]; headers["accept-encoding"] = "identity";
      const u = new URL(upstream);
      const up = https.request({ host: u.host, path: req.url.startsWith("/backend-api") || req.url.startsWith("/codex") || req.url.startsWith("/v1") ? req.url : req.url, method: req.method, headers: { ...headers, host: u.host, "content-length": raw.length } }, (ur) => {
        rec.status = ur.statusCode; const h = { ...ur.headers }; delete h["content-length"]; delete h["transfer-encoding"]; delete h["content-encoding"];
        res.writeHead(ur.statusCode, h);
        ur.on("data", (c) => { if (kind !== "other" && rec.responseText.length < 400000) rec.responseText += c.toString("utf8"); res.write(c); });
        ur.on("end", () => { res.end(); if (kind !== "other") timeline.push({ t: now(), src: "model", seq, kind: "response-completed", reqKind: kind, status: ur.statusCode }); });
      });
      up.on("error", (e) => { rec.error = String(e.message); try { res.writeHead(502); res.end(); } catch { /* */ } });
      up.end(raw);
    });
  });
  server.on("upgrade", (req, socket) => { state.upgrades.push({ url: req.url, t: now() }); socket.end("HTTP/1.1 404 Not Found\r\n\r\n"); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, state, port: server.address().port, close: () => server.close() })));
}
module.exports.startProxy = startProxy;
