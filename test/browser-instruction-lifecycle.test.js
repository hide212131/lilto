const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mock } = require("node:test");

const { AgentRuntime, createCodexThreadFromAppServer, createCodexThreadFromSdk, BROWSER_COMPACTION_STOP_MESSAGE } = require("../dist/main/agent-sdk.js");
const { CodexAppServerClient } = require("../dist/main/codex-app-server-client.js");
const { resolveBrowserInstructionUpdate, BROWSER_INSTRUCTION_CONTEXT_KEY } = require("../dist/main/agent-sdk-config.js");
const { BrowserInstructionStateStore, browserInstructionNamespace } = require("../dist/main/browser-instruction-state-store.js");

const silent = { info() {}, error() {} };
const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

const OFF = resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: false });
const OFF_WITH_EVAL_SETTING = resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: true });
const ON = resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: false });
const ON_EVAL = resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: true });
const LAUNCH = { command: "n", args: ["s"], env: { LILTO_BROWSER_BRIDGE_TOKEN: "t" } };
const ctxFor = (update) => ({ update, ...(update.state.browser === "on" ? { launch: LAUNCH } : {}) });

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-lifecycle-"));
  dirs.push(dir);
  return path.join(dir, "state.json");
}
const openStore = (file, io) => new BrowserInstructionStateStore({ filePath: file, io, logger: silent });

/**
 * Scripted App Server behind the real CodexAppServerClient: only transport methods are replaced, so the
 * notification fan-out (listeners + queue) is the production code. `modelItems` counts lilto state items the way
 * the model input would: one per additionalContext that was actually sent.
 */
function fakeServer(script = {}) {
  const log = { requests: [], turns: 0, modelStateItems: 0, interrupts: [] };
  const clients = new Set();
  const held = [];
  let threadSeq = 0;
  const emit = (client, method, params) => setImmediate(() => client.handleLine(JSON.stringify({ method, params })));
  const mocks = [
    mock.method(CodexAppServerClient.prototype, "start", async function () { clients.add(this); }),
    mock.method(CodexAppServerClient.prototype, "close", function () {}),
    mock.method(CodexAppServerClient.prototype, "request", async function (method, params) {
      log.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: `thread-${++threadSeq}` } };
      if (method === "turn/interrupt") {
        log.interrupts.push(params);
        held.length = 0;
        emit(this, "turn/completed", { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } });
        return {};
      }
      if (method === "turn/start") {
        const index = log.turns++;
        if (params.additionalContext) log.modelStateItems += Object.keys(params.additionalContext).length;
        const behavior = typeof script === "function" ? script(index, params, log) : (script[index] ?? {});
        if (behavior.rpcError) throw new Error(behavior.rpcError);
        const turnId = `turn-${index}`;
        const threadId = params.threadId;
        setImmediate(() => {
          if (behavior.connectionLost) { this.nextNotificationWaiters?.forEach?.((w) => w.reject(new Error("codex app-server exited unexpectedly"))); return; }
          for (const n of behavior.notifications ?? []) this.handleLine(JSON.stringify({ method: n.method, params: { threadId, turnId, ...n.params } }));
          if (behavior.hold) { held.push({ client: this, threadId, turnId }); return; } // wait for finishHeld() / turn/interrupt
          this.handleLine(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: behavior.status ?? "completed" } } }));
        });
        return { turn: { id: turnId } };
      }
      return {};
    })
  ];
  const finishHeld = () => { for (const h of held.splice(0)) emit(h.client, "turn/completed", { threadId: h.threadId, turn: { id: h.turnId, status: "completed" } }); };
  return { log, finishHeld, restore: () => mocks.forEach((m) => m.mock.restore()) };
}

const compactionStarted = { method: "item/started", params: { item: { type: "contextCompaction", id: "c1" } } };
const userMessageStarted = { method: "item/started", params: { item: { type: "userMessage", id: "u1" } } };
const compactionCompleted = { method: "item/completed", params: { item: { type: "contextCompaction", id: "c1" } } };

async function run(thread, browserRun, signal) {
  const events = [];
  try {
    const stream = await thread.runStreamed("hello", { browserRun, signal });
    for await (const e of stream.events) events.push(e);
  } catch (error) { events.push({ type: "threw", message: error.message }); }
  return events;
}
const open = (store, threadId) => createCodexThreadFromAppServer({ apiKey: "k", cwd: "/w", codexHomeDir: "/c", homeDir: "/h", threadId, instructionStore: store });
const NS = browserInstructionNamespace("/c");
const sentTurns = (server) => server.log.requests.filter((r) => r.method === "turn/start").map((r) => Boolean(r.params.additionalContext));

test("unknown thread: one item on the first turn, none while the state is unchanged", async () => {
  const server = fakeServer();
  try {
    const thread = await open(openStore(tmpFile()), "legacy-thread");
    for (let i = 0; i < 3; i++) await run(thread, ctxFor(OFF));
    assert.deepEqual(sentTurns(server), [true, false, false]);
    assert.equal(server.log.modelStateItems, 1);
  } finally { server.restore(); }
});

test("OFF -> ON -> OFF and evaluate OFF -> ON -> OFF each send exactly one item, none in between", async () => {
  const server = fakeServer();
  try {
    const thread = await open(openStore(tmpFile()));
    const sequence = [OFF, OFF, ON, ON, ON_EVAL, ON_EVAL, ON, OFF, OFF];
    for (const update of sequence) await run(thread, ctxFor(update));
    assert.deepEqual(sentTurns(server), [true, false, true, false, true, false, true, true, false]);
    const sent = server.log.requests.filter((r) => r.method === "turn/start" && r.params.additionalContext);
    assert.deepEqual(sent.map((r) => r.params.additionalContext[BROWSER_INSTRUCTION_CONTEXT_KEY].value), [OFF, ON, ON_EVAL, ON, OFF].map((u) => u.text));
    assert.ok(sent.every((r) => r.params.additionalContext[BROWSER_INSTRUCTION_CONTEXT_KEY].kind === "application"));
  } finally { server.restore(); }
});

test("while OFF, an evaluate setting change is not a state change; revising the text re-sends once", async () => {
  const server = fakeServer();
  try {
    const thread = await open(openStore(tmpFile()));
    await run(thread, ctxFor(OFF));
    await run(thread, ctxFor(OFF_WITH_EVAL_SETTING));
    assert.deepEqual(OFF.state, OFF_WITH_EVAL_SETTING.state);
    const revised = { text: `${OFF.text}\nrevised`, state: { ...OFF.state, instructionDigest: "digest-of-revised-text" } };
    await run(thread, ctxFor(revised));
    await run(thread, ctxFor(revised));
    assert.deepEqual(sentTurns(server), [true, false, true, false]);
  } finally { server.restore(); }
});

test("new thread: the first turn carries the update (OFF too), start alone confirms nothing, and no thread param carries instructions", async () => {
  const server = fakeServer({ 0: { status: "failed" } });
  try {
    const store = openStore(tmpFile());
    const thread = await open(store);
    await run(thread, ctxFor(OFF));
    assert.equal(store.peek(NS, "thread-1").status, "unknown", "failed first turn: start success did not confirm");
    await run(thread, ctxFor(OFF));
    await run(thread, ctxFor(OFF));
    assert.deepEqual(sentTurns(server), [true, true, false]);
    for (const r of server.log.requests.filter((x) => x.method === "thread/start" || x.method === "thread/resume")) {
      assert.equal("developerInstructions" in r.params, false);
    }
    assert.deepEqual(server.log.requests.filter((r) => r.method === "thread/resume").map((r) => r.params.threadId), ["thread-1", "thread-1"], "the same Thread object keeps resuming the thread it created");
    assert.equal(thread.id, "thread-1");
  } finally { server.restore(); }
});

test("failures re-send: RPC error, failed turn, interruption, lost connection", async () => {
  const cases = {
    "turn/start RPC error": { 1: { rpcError: "boom" } },
    "turn failed": { 1: { status: "failed" } },
    "turn interrupted": { 1: { status: "interrupted" } },
    "connection lost": { 1: { connectionLost: true } }
  };
  for (const [name, script] of Object.entries(cases)) {
    const server = fakeServer(script);
    try {
      const thread = await open(openStore(tmpFile()), "t");
      await run(thread, ctxFor(OFF)); // turn 0: confirms OFF
      await run(thread, ctxFor(OFF)); // turn 1: fails (no update needed, still must not be trusted afterwards)
      await run(thread, ctxFor(OFF)); // turn 2: must send again
      await run(thread, ctxFor(OFF)); // turn 3: confirmed again
      assert.deepEqual(sentTurns(server), [true, false, true, false], name);
    } finally { server.restore(); }
  }
});

test("a failure of an ON update that may have arrived never revives the older OFF record", async () => {
  const server = fakeServer({ 1: { status: "failed" } });
  try {
    const store = openStore(tmpFile());
    const thread = await open(store, "t");
    await run(thread, ctxFor(OFF));
    await run(thread, ctxFor(ON)); // ON delivered then the turn failed
    assert.equal(store.peek(NS, "t").confirmedState, undefined);
    await run(thread, ctxFor(OFF)); // must re-announce OFF
    assert.deepEqual(sentTurns(server), [true, true, true]);
  } finally { server.restore(); }
});

test("a failed confirm save re-sends on the next turn but keeps the answer", async () => {
  const server = fakeServer();
  try {
    const file = tmpFile();
    let failWrites = false;
    const io = { readFile: async () => null, writeFileAtomic: async (f, c) => { if (failWrites) throw new Error("EIO"); fs.writeFileSync(f, c); } };
    const store = openStore(file, io);
    const thread = await open(store, "t");
    const stream = await thread.runStreamed("x", { browserRun: ctxFor(OFF) });
    failWrites = true; // begin() was persisted; the confirm save will fail
    const events = [];
    for await (const e of stream.events) events.push(e);
    assert.equal(events.some((e) => e.type === "turn.failed" || e.type === "error"), false, "the turn itself is not reported as failed");
    failWrites = false;
    await run(thread, ctxFor(OFF));
    assert.deepEqual(sentTurns(server), [true, true]);
  } finally { server.restore(); }
});

test("store that cannot persist pending: no turn/start at all", async () => {
  const server = fakeServer();
  try {
    const io = { readFile: async () => null, writeFileAtomic: async () => { throw new Error("read-only disk"); } };
    const thread = await open(openStore(tmpFile(), io), "t");
    const events = await run(thread, ctxFor(OFF));
    assert.equal(server.log.turns, 0);
    assert.equal(events[0].type, "threw");
  } finally { server.restore(); }
});

test("new process: confirmed is restored (no resend); a crash mid-turn is unknown", async () => {
  const server = fakeServer();
  try {
    const file = tmpFile();
    await run(await open(openStore(file), "t"), ctxFor(ON));
    await run(await open(openStore(file), "t"), ctxFor(ON)); // fresh store + fresh adapter = restarted app
    assert.deepEqual(sentTurns(server), [true, false]);
    // crash: a turn was begun and never settled
    await openStore(file).begin(NS, "t", ON.state);
    await run(await open(openStore(file), "t"), ctxFor(ON));
    assert.deepEqual(sentTurns(server), [true, false, true]);
  } finally { server.restore(); }
});

test("two runs on the same backend thread: the second is refused; another thread still runs; released afterwards", async () => {
  const server = fakeServer((i) => (i === 0 ? { hold: true } : {}));
  try {
    const store = openStore(tmpFile());
    const first = await open(store, "shared");
    const second = await open(store, "shared"); // e.g. another conversation id resolving to the same backend thread
    const other = await open(store, "different");
    const stream = await first.runStreamed("a", { browserRun: ctxFor(OFF) });
    const draining = (async () => { for await (const _ of stream.events) { /* drain */ } })();
    await assert.rejects(second.runStreamed("b", { browserRun: ctxFor(OFF) }), /使用中/);
    assert.equal(server.log.turns, 1, "the refused run never reached turn/start");
    assert.equal((await run(other, ctxFor(OFF))).some((e) => e.type === "threw"), false);
    server.finishHeld();
    await draining;
    assert.equal((await run(second, ctxFor(OFF))).some((e) => e.type === "threw"), false, "released after the first turn ended");
    assert.deepEqual(sentTurns(server), [true, true, false], "refused attempt did not touch the record");
  } finally { server.restore(); }
});

test("compaction at its START stops the turn before it continues; the thread is unknown; the next turn re-sends", async () => {
  const server = fakeServer({ 1: { hold: true, notifications: [compactionStarted] } });
  try {
    const store = openStore(tmpFile());
    const thread = await open(store, "t");
    await run(thread, ctxFor(ON)); // confirms ON
    const events = await run(thread, ctxFor(ON)); // compaction starts mid-turn
    assert.equal(server.log.interrupts.length, 1);
    assert.deepEqual(server.log.interrupts[0], { threadId: "t", turnId: "turn-1" });
    assert.equal(events.at(-1).type, "turn.failed");
    assert.equal(events.at(-1).error.message, BROWSER_COMPACTION_STOP_MESSAGE);
    assert.equal(store.peek(NS, "t").status, "unknown");
    await run(thread, ctxFor(ON));
    await run(thread, ctxFor(ON));
    assert.deepEqual(sentTurns(server), [true, false, true, false]);
  } finally { server.restore(); }
});

test("a turn that straddles a compaction is never confirmed, even if it completes normally", async () => {
  const server = fakeServer({ 1: { notifications: [compactionStarted, compactionCompleted], status: "completed" } });
  try {
    const store = openStore(tmpFile());
    const thread = await open(store, "t");
    await run(thread, ctxFor(OFF));
    await run(thread, ctxFor(OFF)); // interrupt cannot have landed in time: the turn still completes
    assert.equal(store.peek(NS, "t").status, "unknown");
    await run(thread, ctxFor(OFF));
    assert.deepEqual(sentTurns(server), [true, false, true]);
  } finally { server.restore(); }
});

test("repeated compaction: only the first turn is stopped; the retry lets it run, is never confirmed, and recovers after one more update", async () => {
  const server = fakeServer((i) => (i === 1 ? { hold: true, notifications: [compactionStarted] } : i === 2 ? { notifications: [compactionStarted, compactionCompleted] } : {}));
  try {
    const store = openStore(tmpFile());
    const thread = await open(store, "t");
    await run(thread, ctxFor(OFF)); // 0: confirmed
    const first = await run(thread, ctxFor(OFF)); // 1: compaction starts -> stopped (this discards the compaction)
    assert.equal(first.at(-1).error?.message, BROWSER_COMPACTION_STOP_MESSAGE);
    assert.equal(store.getCompactionInterrupts(NS, "t"), 1);
    const retry = await run(thread, ctxFor(OFF)); // 2: compaction again: NOT stopped (would loop), completes
    assert.equal(retry.some((e) => e.type === "turn.failed" || e.type === "error"), false);
    assert.equal(server.log.interrupts.length, 1, "no second interrupt");
    assert.equal(store.peek(NS, "t").status, "unknown", "a turn that saw a compaction is never confirmed");
    assert.equal(store.getCompactionInterrupts(NS, "t"), 0, "streak ends with the uninterrupted retry");
    await run(thread, ctxFor(OFF)); // 3: re-sent, confirmed
    await run(thread, ctxFor(OFF)); // 4: nothing to send
    assert.deepEqual(sentTurns(server), [true, false, true, true, false]);
  } finally { server.restore(); }
});

test("compaction before this turn's own user message does not stop a turn that carries the update; the same compaction after it does", async () => {
  const server = fakeServer((i) => (i === 0
    ? { notifications: [compactionStarted, compactionCompleted] } // pre-turn, update being sent (unknown thread)
    : i === 1
      ? { hold: true, notifications: [userMessageStarted, compactionStarted] } // mid-turn, no update (state would be lost)
      : i === 2
        ? { notifications: [userMessageStarted, compactionStarted, compactionCompleted] } // retry: update sent, but mid-turn and already stopped once
        : {}));
  try {
    const store = openStore(tmpFile());
    const thread = await open(store, "t");
    const first = await run(thread, ctxFor(OFF));
    assert.equal(first.some((e) => e.type === "turn.failed"), false, "pre-turn + update: not stopped");
    assert.equal(server.log.interrupts.length, 0);
    assert.equal(store.peek(NS, "t").status, "unknown", "still never confirmed across a compaction");
    await run(thread, ctxFor(OFF)); // 1: update re-sent (unknown), confirmed? it carries a mid-turn compaction => stopped
    assert.equal(server.log.interrupts.length, 1, "mid-turn compaction stops even a turn that carried the update");
    const retry = await run(thread, ctxFor(OFF)); // 2: stopped once already: runs through
    assert.equal(retry.some((e) => e.type === "turn.failed"), false);
    assert.equal(server.log.interrupts.length, 1);
  } finally { server.restore(); }
});

test("a managed compaction listener ignores other threads and never fires for excluded runs", async () => {
  const server = fakeServer({ 0: { notifications: [{ method: "item/started", params: { threadId: "someone-else", item: { type: "contextCompaction", id: "c" } } }] } });
  try {
    const store = openStore(tmpFile());
    await run(await open(store, "t"), ctxFor(OFF));
    assert.equal(server.log.interrupts.length, 0, "foreign thread's compaction ignored");
  } finally { server.restore(); }
  const excluded = fakeServer({ 0: { notifications: [compactionStarted] } });
  try {
    await run(await open(openStore(tmpFile()), "t"), undefined);
    assert.equal(excluded.log.interrupts.length, 0, "excluded run is never interrupted");
  } finally { excluded.restore(); }
});

test("steer stays on the active turn: no state comparison, no additional context, no record change", async () => {
  const server = fakeServer((i) => (i === 0 ? { hold: true } : {}));
  try {
    const store = openStore(tmpFile());
    const thread = await open(store, "t");
    const stream = await thread.runStreamed("a", { browserRun: ctxFor(ON) });
    const draining = (async () => { for await (const _ of stream.events) { /* drain */ } })();
    await new Promise((r) => setImmediate(r)); // let the scripted turn get going
    await thread.steer("more");
    const steer = server.log.requests.find((r) => r.method === "turn/steer");
    assert.ok(steer);
    assert.equal("additionalContext" in steer.params, false);
    assert.equal(store.peek(NS, "t").status, "pending");
    server.finishHeld();
    await draining;
    assert.equal(store.peek(NS, "t").status, "confirmed");
  } finally { server.restore(); }
});

/* ------------------------------------------------------------ runtime classification and SDK entry */

function runtimeWith({ support, store, sessions, createSession }) {
  return new AgentRuntime({
    authService: { getState: () => ({ phase: "authenticated" }), getApiKey: () => null },
    workspaceDir: "/w",
    browserSupport: support,
    instructionStore: store,
    createSession: createSession ?? (async () => ({
      id: "t",
      async runStreamed(_i, options) {
        sessions.push(options?.browserRun ?? null);
        return { events: (async function* () { yield { type: "item.completed", item: { id: "m", type: "agent_message", text: "ok" } }; })() };
      }
    }))
  });
}
const settings = () => ({
  activeProvider: "oauth", oauthProvider: "openai-codex", oauthModelId: "m",
  customProvider: { name: "", baseUrl: "", apiKey: "", modelId: "" }, networkProxy: { useProxy: false },
  windowsSandbox: { mode: "off", privateDesktop: true }, chatSettings: { enterToSend: false, globalShortcut: "x" },
  heartbeatSettings: { enabled: false, intervalMinutes: 30 }, browserSettings: { enabled: true, autoOpenOnToolUse: true }, updatedAt: 1
});
function supportFor(decision, extra = {}) {
  const calls = [];
  return { calls, resolve: (input) => { calls.push(input); return typeof decision === "function" ? decision() : decision; }, begin: () => null, policyRevision: () => 1, revokeAll() {}, ...extra };
}

test("classification uses the effective options: heartbeat / fresh / ephemeral / internal service / no conversation are excluded; a persistent scheduler follow-up is not", async () => {
  const sessions = [];
  const support = supportFor({ kind: "off", update: OFF });
  const runtime = runtimeWith({ support, sessions });
  const followUp = "以下はこの会話で発火した scheduler 通知です。確認してください";
  await runtime.submitPrompt("hb", settings(), { requestId: "1", conversationId: "A", mode: "heartbeat", freshContext: true });
  await runtime.submitPrompt("fresh", settings(), { requestId: "2", conversationId: "A", freshContext: true });
  await runtime.submitPrompt("eph", settings(), { requestId: "3", conversationId: "A", ephemeralThread: true });
  await runtime.submitPrompt("svc", settings(), { requestId: "4", conversationId: "A", serviceName: "lilto-background" });
  await runtime.submitPrompt("anon", settings(), { requestId: "5" });
  await runtime.submitPrompt(`${followUp} fresh`, settings(), { requestId: "6", conversationId: "A", freshContext: true });
  assert.deepEqual(sessions, [null, null, null, null, null, null]);
  assert.equal(support.calls.length, 0, "excluded runs never ask for a decision or a capability");
  await runtime.submitPrompt(followUp, settings(), { requestId: "7", conversationId: "A" });
  assert.equal(support.calls.length, 1);
  assert.equal(sessions.at(-1).update.state.browser, "off");
});

test("ON that cannot issue a capability: no session turn, no store write, run fails", async () => {
  const sessions = [];
  const file = tmpFile();
  const store = openStore(file);
  for (const reason of ["issue-failed", "settings-changing"]) {
    const runtime = runtimeWith({ support: supportFor({ kind: "unavailable", reason }), store, sessions });
    const result = await runtime.submitPrompt("x", settings(), { requestId: "r", conversationId: "A" });
    assert.equal(result.ok, false);
    assert.equal(result.error.retryable, true);
  }
  assert.equal(sessions.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("a setting change while the run was preparing re-resolves the snapshot before the turn", async () => {
  const sessions = [];
  let revision = 1;
  let n = 0;
  const ended = [];
  const support = supportFor(() => {
    n++;
    return n === 1 ? { kind: "on", update: ON, launch: LAUNCH, end: () => ended.push("first") } : { kind: "off", update: OFF };
  }, { policyRevision: () => revision });
  const runtime = runtimeWith({ support, sessions, createSession: async () => { revision = 2; return { id: "t", async runStreamed(_i, o) { sessions.push(o.browserRun); return { events: (async function* () {})() }; } }; } });
  const result = await runtime.submitPrompt("x", settings(), { requestId: "r", conversationId: "A" });
  assert.equal(result.ok, true);
  assert.deepEqual(ended, ["first"], "stale lease revoked");
  assert.equal(sessions[0].update.state.browser, "off");
});

test("SDK entry: browser-managed runs are delegated to the App Server adapter (ID kept); other runs stay on the SDK", async () => {
  const sdkRuns = [];
  const delegated = [];
  const sdkThread = { id: "sdk-thread", async runStreamed(input, o) { sdkRuns.push({ input, o }); return { events: (async function* () {})() }; }, steer: async () => { throw new Error("sdk steer"); } };
  const appThread = { id: "app-thread", async runStreamed(input, o) { delegated.push({ input, o }); return { events: (async function* () {})() }; }, steer: async (t) => { delegated.push({ steer: t }); } };
  let created = null;
  const thread = await createCodexThreadFromSdk({ apiKey: "k", threadId: "sdk-thread", codexHomeDir: "/c", homeDir: "/h", instructionStore: openStore(tmpFile()) }, {
    createCodex: () => ({ startThread: () => sdkThread, resumeThread: () => sdkThread }),
    resolveEnvironment: async () => ({}),
    createAppServerThread: async (options) => { created = options; return appThread; }
  });
  const signal = new AbortController().signal;
  const images = [{ mimeType: "image/png", base64: "AA==" }];
  await (await thread.runStreamed("plain", { signal })).events.next();
  assert.equal(sdkRuns.length, 1);
  assert.equal(created, null, "excluded run never created an adapter");
  const browserRun = ctxFor(OFF);
  const stream = await thread.runStreamed("managed", { signal, images, browserRun });
  await stream.events.next();
  assert.equal(created.threadId, "sdk-thread");
  assert.ok(created.instructionStore);
  assert.deepEqual(delegated[0].o, { signal, images, browserRun });
  assert.equal(thread.id, "app-thread");
  await thread.steer("more");
  assert.deepEqual(delegated.at(-1), { steer: "more" });
});

test("both entries behave the same: unknown -> send -> same-state skip -> change once -> failure re-sends", async () => {
  const server = fakeServer({ 4: { status: "failed" } });
  try {
    for (const entry of ["app-server", "sdk"]) {
      server.log.requests.length = 0;
      server.log.turns = 0;
      const store = openStore(tmpFile());
      const options = { apiKey: "k", cwd: "/w", codexHomeDir: "/c", homeDir: "/h", instructionStore: store, threadId: `legacy-${entry}` };
      const thread = entry === "app-server"
        ? await createCodexThreadFromAppServer(options)
        : await createCodexThreadFromSdk(options, {
            createCodex: () => ({ startThread: () => ({ id: null, runStreamed: async () => { throw new Error("must not be used"); } }), resumeThread: () => ({ id: null, runStreamed: async () => { throw new Error("must not be used"); } }) }),
            resolveEnvironment: async () => ({})
          });
      server.log.turns = 0;
      const seq = [OFF, OFF, ON, ON, ON, ON];
      // the script fails the 5th turn (index 4): the one after it must re-send even though the state is unchanged
      for (const update of seq) await run(thread, ctxFor(update));
      assert.deepEqual(sentTurns(server), [true, false, true, false, false, true], entry);
    }
  } finally { server.restore(); }
});

test("heartbeat never resumes the conversation's backend thread, so it cannot touch that thread's record", async () => {
  const threadIds = [];
  const sessions = [];
  const runtime = runtimeWith({
    support: supportFor({ kind: "off", update: OFF }), sessions,
    createSession: async (options) => {
      threadIds.push(options.threadId ?? null);
      return { id: options.threadId ?? null, async runStreamed(_i, o) {
        sessions.push(o?.browserRun ?? null);
        return { events: (async function* () { yield { type: "thread.started", thread_id: "backend-1" }; })() };
      } };
    }
  });
  await runtime.submitPrompt("hello", settings(), { requestId: "1", conversationId: "A" });
  await runtime.submitPrompt("patrol", settings(), { requestId: "2", conversationId: "A", mode: "heartbeat", freshContext: true });
  await runtime.submitPrompt("again", settings(), { requestId: "3", conversationId: "A" });
  // The heartbeat session is created without a thread id (fresh backend thread); the regular conversation's session is reused from cache.
  assert.deepEqual(threadIds, [null, null]);
  assert.deepEqual(sessions.map((s) => s !== null), [true, false, true]);
});
