/**
 * Product-path lab for the browser-instruction lifecycle (issue #43).
 *
 * Drives the REAL product code (createCodexThreadFromAppServer + BrowserInstructionStateStore) against the BUNDLED
 * Codex App Server and a local recording Responses server. No model, no auth, no network. Every run uses its own
 * CODEX_HOME / workspace / state file under the OS temp dir.
 *
 * The recording server sees exactly what App Server sends to the model, so "how many lilto state items are in the
 * model input" is measured on the wire instead of inferred from RPC arguments.
 *
 * Needs `npm run build:unit` (uses dist/).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const dist = (p) => require(path.join(root, "dist", p));

const TARGETS = {
  "darwin-arm64": ["codex-darwin-arm64", "aarch64-apple-darwin"],
  "darwin-x64": ["codex-darwin-x64", "x86_64-apple-darwin"],
  "linux-x64": ["codex-linux-x64", "x86_64-unknown-linux-musl"],
  "linux-arm64": ["codex-linux-arm64", "aarch64-unknown-linux-musl"],
  "win32-x64": ["codex-win32-x64", "x86_64-pc-windows-msvc"],
  "win32-arm64": ["codex-win32-arm64", "aarch64-pc-windows-msvc"]
};
const [PACKAGE_DIR, TRIPLE] = TARGETS[`${process.platform}-${process.arch}`] ?? [];
const BIN_DIR = path.join(root, "node_modules/@openai", PACKAGE_DIR ?? "unsupported", "vendor", TRIPLE ?? "unsupported", "bin");
const BIN = path.join(BIN_DIR, process.platform === "win32" ? "codex.exe" : "codex");

const HEADER = "[Lilto embedded-browser state update]";
const AUTO_LIMIT = 6000;
const BIG_USAGE = 20000;

function codexVersion() {
  const out = spawnSync(BIN, ["--version"], { encoding: "utf8" });
  return (out.stdout || out.stderr || "").trim();
}

const flatten = (item) => Array.isArray(item.content)
  ? item.content.map((c) => c.text ?? "").join("\n")
  : typeof item.content === "string" ? item.content : "";

/** lilto state items (developer role, carrying the update header) inside one model request body. */
function stateItems(body) {
  return (body?.input ?? [])
    .map((item, idx) => ({ idx, role: item.role, type: item.type, text: flatten(item) }))
    .filter((i) => i.role === "developer" && i.text.includes(HEADER));
}

/** Same surface as startRecorder()'s result, but the server lives in a child process (see recorder-process.js). */
async function startRemoteRecorder() {
  const { fork } = require("node:child_process");
  const child = fork(path.join(__dirname, "recorder-process.js"), [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, execPath: process.execPath });
  const requests = [];
  const waiters = new Map();
  let ping = 0;
  const port = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.on("message", (m) => {
      if (m.type === "ready") resolve(m.port);
      else if (m.type === "request") requests.push(m.rec);
      else if (m.type === "pong") { waiters.get(m.id)?.(); waiters.delete(m.id); }
    });
  });
  const values = {};
  const state = new Proxy(values, { set(target, key, value) { target[key] = value; child.send({ cmd: "state", key, value }); return true; }, get: (target, key) => target[key] });
  return {
    requests, state, port,
    /** Resolves once every request message sent before now has been mirrored into `requests`. */
    sync: () => new Promise((resolve) => { const id = ++ping; waiters.set(id, resolve); child.send({ cmd: "ping", id }); }),
    close: () => { try { child.send({ cmd: "close" }); } catch { /* gone */ } setTimeout(() => child.kill(), 500).unref(); }
  };
}

/**
 * options.live = { model, autoLimit }: a REAL model through a recording forwarding proxy (provider named "OpenAI" so the
 * real compaction path applies). Copies only ~/.codex/auth.json into the isolated CODEX_HOME; dispose() removes it.
 * options.extraPath: directories put before PATH for the App Server (e.g. a fake external browser CLI).
 */
async function createLab({ autoCompact = false, label = "lab", recorderProcess = false, live = null, extraPath = [] } = {}) {
  const { startRecorder, startProxy, makeHome } = require("./compaction-probe-lib.js");
  const { CodexAppServerClient } = dist("main/codex-app-server-client.js");
  const { createCodexThreadFromAppServer } = dist("main/agent-sdk.js");
  const { BrowserInstructionStateStore, browserInstructionNamespace } = dist("main/browser-instruction-state-store.js");
  const sdkConfig = dist("main/agent-sdk-config.js");

  const timeline = [];
  const recorder = live ? await startProxy(timeline) : recorderProcess ? await startRemoteRecorder() : await startRecorder(timeline);
  let home;
  if (live) {
    home = fs.mkdtempSync(path.join(os.tmpdir(), `lilto-${label}-codexhome-`));
    fs.writeFileSync(path.join(home, "config.toml"), [`model = "${live.model}"`, 'model_provider = "probe"', ...(autoCompact ? [`model_auto_compact_token_limit = ${live.autoLimit ?? 17500}`] : []), "", "[model_providers.probe]", 'name = "OpenAI"', `base_url = "http://127.0.0.1:${recorder.port}/backend-api/codex"`, 'wire_api = "responses"', "supports_websockets = false", "requires_openai_auth = true"].join("\n") + "\n");
    fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
    fs.chmodSync(path.join(home, "auth.json"), 0o600);
  } else {
    home = makeHome(recorder.port, autoCompact ? [`model_auto_compact_token_limit = ${AUTO_LIMIT}`] : []);
  }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `lilto-${label}-ws-`));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), `lilto-${label}-state-`));
  const stateFile = path.join(stateDir, "browser-instruction-state.json");
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), `lilto-${label}-userhome-`));

  // The product spawns `codex` from PATH when it is not packaged: put the bundled binary first.
  const previousPath = process.env.PATH;
  process.env.PATH = [...extraPath, BIN_DIR, previousPath].join(path.delimiter);

  // Observe the real client's RPC traffic without replacing it.
  const rpc = [];
  const clients = new Set();
  const originalRequest = CodexAppServerClient.prototype.request;
  const originalStart = CodexAppServerClient.prototype.start;
  CodexAppServerClient.prototype.request = function patched(method, params, ...rest) {
    rpc.push({ t: Date.now(), method, params });
    return originalRequest.call(this, method, params, ...rest);
  };
  CodexAppServerClient.prototype.start = function patched(...args) { clients.add(this); return originalStart.apply(this, args); };

  const cleanups = [];
  const lab = {
    timeline, recorder, home, ws, stateFile, rpc, sdkConfig, dist, version: codexVersion(), bin: BIN,
    namespace: browserInstructionNamespace(home),
    update: {
      off: sdkConfig.resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: false }),
      on: sdkConfig.resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: false }),
      onEval: sdkConfig.resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: true })
    },
    /** A fresh "app process": new store object over the same file and a new adapter factory. */
    newStore(io) { return new BrowserInstructionStateStore({ filePath: stateFile, io, logger: { info() {}, error() {} } }); },
    async openThread(store, threadId) {
      return createCodexThreadFromAppServer({ apiKey: null, model: { id: live ? live.model : "probe-model" }, cwd: ws, codexHomeDir: home, homeDir, threadId, instructionStore: store });
    },
    launchFor(update) {
      const stub = path.join(__dirname, "probe-stub-mcp.js");
      return update.state.browser === "on"
        ? { command: process.execPath, args: [stub], env: { PROBE_STUB_TOOLS: update.state.evaluate ? "17" : "16", PROBE_PAGE_BASE: lab.pageBase ?? "" } }
        : undefined;
    },
    ctx(update) { const launch = lab.launchFor(update); return { update, ...(launch ? { launch } : {}) }; },
    /** One product turn. Resolves with what App Server sent to the model and what the adapter sent to App Server. */
    async turn(thread, update, { prompt = "ping", signal, timeoutMs = 60000, beforeConsume } = {}) {
      const reqBefore = recorder.requests.length;
      const rpcBefore = rpc.length;
      const events = [];
      let thrown = null;
      const started = Date.now();
      try {
        const stream = await thread.runStreamed(prompt, { browserRun: update ? lab.ctx(update) : undefined, signal });
        if (beforeConsume) await beforeConsume();
        const deadline = Date.now() + timeoutMs;
        const it = stream.events[Symbol.asyncIterator]();
        for (;;) {
          const r = await Promise.race([it.next(), new Promise((res) => setTimeout(() => res({ timeout: true }), Math.max(1, deadline - Date.now())))]);
          if (r.timeout) { thrown = new Error("turn timeout"); await it.return?.(); break; }
          if (r.done) break;
          events.push(r.value);
        }
      } catch (error) { thrown = error; }
      await recorder.sync?.();
      const reqs = recorder.requests.slice(reqBefore);
      const calls = rpc.slice(rpcBefore);
      const turnStart = calls.find((c) => c.method === "turn/start");
      const normal = reqs.filter((r) => r.kind === "normal");
      const compIdx = reqs.findIndex((r) => r.kind === "compaction");
      const last = normal.at(-1);
      return {
        thrown: thrown ? String(thrown.message) : null,
        events,
        failedEvent: events.find((e) => e.type === "turn.failed" || e.type === "error") ?? null,
        threadId: turnStart?.params.threadId ?? null,
        sentAdditionalContext: Boolean(turnStart?.params.additionalContext),
        turnStartCount: calls.filter((c) => c.method === "turn/start").length,
        interrupts: calls.filter((c) => c.method === "turn/interrupt").length,
        modelRequests: reqs.length,
        normalRequests: normal.length,
        compactionRequests: reqs.filter((r) => r.kind === "compaction").length,
        normalAfterCompaction: compIdx >= 0 ? reqs.slice(compIdx + 1).filter((r) => r.kind === "normal").length : 0,
        stateItemsInLastRequest: last ? stateItems(last.body).length : 0,
        lastRequestHasText: (text) => Boolean(last && stateItems(last.body).some((i) => i.text.includes(text))),
        lastRequestTools: last ? JSON.stringify(last.body?.tools ?? []) : "",
        elapsedMs: Date.now() - started
      };
    },
    killAppServers() { for (const c of clients) { try { c.child?.kill("SIGKILL"); } catch { /* gone */ } } },
    liveClients: () => [...clients].filter((c) => c.child),
    async dispose() {
      CodexAppServerClient.prototype.request = originalRequest;
      CodexAppServerClient.prototype.start = originalStart;
      for (const c of clients) { try { c.close(); } catch { /* */ } }
      recorder.close();
      process.env.PATH = previousPath;
      await new Promise((r) => setTimeout(r, 150)); // let the killed App Server finish writing before its home goes away
      for (const dir of [home, ws, stateDir, homeDir]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      for (const fn of cleanups) fn();
    }
  };
  return lab;
}

module.exports = { createLab, stateItems, HEADER, AUTO_LIMIT, BIG_USAGE, BIN, codexVersion };
