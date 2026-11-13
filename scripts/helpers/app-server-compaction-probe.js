/**
 * Issue #43 redesign, task 1: does a turn/start additionalContext (application) survive automatic/manual context
 * compaction and an App Server restart, and how is compaction observable? Deterministic half: a local recording
 * Responses server (provider "probe", so Codex takes the LOCAL compaction path). Needs `npm run build:unit`.
 *
 *   node scripts/helpers/app-server-compaction-probe.js --scenario all --out DIR
 *   scenarios: immediate | compaction | recompact-on | restart | long | detect | interrupt
 *   env PROBE_MODEL (default probe-model), PROBE_N (repeats for interrupt, default 5)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("./compaction-probe-lib.js");
const { Rpc, now, startRecorder, makeHome, inspectInput, allTexts, ctx, designText, findRollout, withBrowserMcpConfig, STUB_MCP } = L;

const TEXTS = allTexts();
const AUTO_LIMIT = 6000, BIG_USAGE = 20000;

class Session {
  /** opts.autoCompact: set model_auto_compact_token_limit (and report big usage so it is crossed). */
  constructor(name, outDir, { autoCompact = false, extraToml = [], live = null } = {}) { Object.assign(this, { name, outDir, timeline: [], procs: [], autoCompact, extraToml, live, turns: [], rolloutNo: 0 }); fs.mkdirSync(outDir, { recursive: true }); }
  async init() {
    if (this.live) { // real model through a recording forwarding proxy (provider named "OpenAI" so remote compaction is eligible)
      this.rec = await L.startProxy(this.timeline);
      this.home = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-cprobe-live-"));
      fs.writeFileSync(path.join(this.home, "config.toml"), [`model = "${this.live.model}"`, 'model_provider = "probe"', ...(this.autoCompact ? [`model_auto_compact_token_limit = ${this.live.autoLimit ?? 3000}`] : []), ...this.extraToml, "", "[model_providers.probe]", 'name = "OpenAI"', `base_url = "http://127.0.0.1:${this.rec.port}/backend-api/codex"`, 'wire_api = "responses"', "supports_websockets = false", "requires_openai_auth = true"].join("\n") + "\n");
      fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(this.home, "auth.json")); fs.chmodSync(path.join(this.home, "auth.json"), 0o600);
    } else {
      this.rec = await startRecorder(this.timeline);
      this.home = makeHome(this.rec.port, [...(this.autoCompact ? [`model_auto_compact_token_limit = ${AUTO_LIMIT}`] : []), ...this.extraToml]);
    }
    this.ws = fs.mkdtempSync(path.join(os.tmpdir(), "cprobe-ws-"));
    return this;
  }
  async open(label) { const c = new Rpc({ home: this.home, timeline: this.timeline, label, env: this.live?.env }); await c.start(); this.procs.push(c); this.c = c; return c; }
  async closeProc(sig = "kill") { await this.c.kill(); this.timeline.push({ t: now(), src: "rpc", proc: this.c.label, kind: "process-killed" }); }
  toolsConfig(tools) { // tools: undefined | 16 | 17
    if (!tools) return undefined;
    return withBrowserMcpConfig(undefined, { command: process.execPath, args: [STUB_MCP], env: { PROBE_STUB_TOOLS: String(tools), PROBE_PAGE_BASE: this.pageBase ?? "" } });
  }
  base(tools) { const config = this.toolsConfig(tools); return { cwd: this.ws, approvalPolicy: "never", sandbox: "danger-full-access", serviceName: "lilto-probe", ...(config ? { config } : {}) }; }
  async start({ tools, developerInstructions } = {}) { const o = await this.c.request("thread/start", { ...this.base(tools), ...(developerInstructions ? { developerInstructions } : {}) }); this.threadId = o.thread.id; return this.threadId; }
  async resume({ tools } = {}) { await this.c.request("thread/resume", { threadId: this.threadId, ...this.base(tools) }); }
  /**
   * One turn. state: undefined | "OFF" | "ON" | "ON_EVAL" -> additionalContext full text. onNote(rec) is called for each
   * notification as it arrives (used to interrupt). Returns per-turn model requests + structural inspection.
   */
  async turn(label, { state, tools, prompt = "ping", settleMs = 400, onNote, timeoutMs = 60000 } = {}) {
    const c = this.c, from = c.notes.length, reqFrom = this.rec.requests.length;
    const cfg = this.toolsConfig(tools);
    if (process.env.PROBE_TRACE) console.error(`[trace] ${this.name} ${label} begin`);
    const tStart = now();
    this.timeline.push({ t: tStart, src: "probe", kind: "turn-begin", label, state: state ?? null });
    let interrupted = null;
    const hook = (n) => { if (onNote) { const r = onNote(n, this); if (r && !interrupted) { interrupted = { at: now(), reason: r.reason, by: n.method + ":" + (n.params?.item?.type ?? "") }; c.request("turn/interrupt", { threadId: this.threadId, turnId: r.turnId ?? n.params?.turnId }, 10000).then(() => { interrupted.rpcDone = now(); }, (e) => { interrupted.err = String(e.message); }); } } };
    const w = { pred: (n) => { hook(n); return false; }, res: () => {} };
    c.waiters.push(w);
    const turnRes = await c.request("turn/start", { threadId: this.threadId, input: [{ type: "text", text: prompt, text_elements: [] }], cwd: this.ws, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, ...(cfg ? { config: cfg } : {}), ...(state ? ctx(TEXTS[L.DESIGN_ID_OF[state]]) : {}) }, 30000);
    const turnId = turnRes?.turn?.id;
    let completed;
    try { completed = await c.waitNote((n) => n.method === "turn/completed" && (n.params?.turn?.id === turnId), timeoutMs, from); } catch (e) { completed = { params: { turn: { status: "probe-timeout" } } }; }
    c.waiters.splice(c.waiters.indexOf(w), 1);
    await new Promise((r) => setTimeout(r, settleMs));
    const reqs = this.rec.requests.slice(reqFrom);
    const rec = {
      label, state: state ?? null, turnId, status: completed.params?.turn?.status, interrupted,
      requests: reqs.map((r) => ({ seq: r.seq, t: r.t, kind: r.kind, responded: r.responded, url: r.url, inspect: r.kind === "normal" ? inspectInput(r.body, TEXTS) : { nItems: (r.body?.input ?? []).length } })),
      notifications: c.notes.slice(from).filter((n) => !/^(item\/agentMessage\/delta|account\/rateLimits|thread\/tokenUsage|thread\/readState|configWarning)/.test(n.method)).map((n) => ({ t: n.t, method: n.method, itemType: n.params?.item?.type, turnId: n.params?.turnId ?? n.params?.turn?.id })),
      items: c.notes.slice(from).filter((n) => n.method === "item/completed").map((n) => n.params?.item).filter(Boolean),
      compactionItems: c.notes.slice(from).filter((n) => /^item\/(started|completed)$/.test(n.method) && n.params?.item?.type === "contextCompaction").map((n) => ({ t: n.t, method: n.method, params: n.params })),
      otherCompactNotes: c.notes.slice(from).filter((n) => /compact/i.test(n.method) && !/^item\//.test(n.method)).map((n) => ({ t: n.t, method: n.method, params: n.params }))
    };
    this.turns.push(rec);
    if (process.env.PROBE_TRACE) console.error(`[trace] ${this.name} ${label} status=${rec.status} reqs=${rec.requests.map((r) => r.kind).join(",")}`);
    return rec;
  }
  async compactManual() { const c = this.c, from = c.notes.length; await c.request("thread/compact/start", { threadId: this.threadId }, 30000); await c.waitNote((n) => n.method === "turn/completed", 60000, from); await new Promise((r) => setTimeout(r, 400)); }
  snapshotRollout(tag) { const f = findRollout(this.home, this.threadId); if (!f) return null; const dst = path.join(this.outDir, `${this.name}.${tag}.rollout.jsonl`); fs.copyFileSync(f, dst); return rolloutCompaction(f); }
  async finish(extra = {}) {
    for (const p of this.procs) await p.kill().catch(() => {});
    this.rec.close();
    const rollout = this.snapshotRollout("final");
    const allNotes = this.procs.flatMap((p) => p.notes.map((n) => ({ proc: p.label, ...n })));
    fs.writeFileSync(path.join(this.outDir, `${this.name}.notifications.json`), JSON.stringify(allNotes.filter((n) => n.method !== "item/agentMessage/delta"), null, 1));
    fs.writeFileSync(path.join(this.outDir, `${this.name}.timeline.json`), JSON.stringify(this.timeline.filter((e) => !/^(item\/agentMessage\/delta|account\/rateLimits|thread\/tokenUsage|thread\/readState|configWarning)/.test(e.method ?? "")), null, 1));
    fs.writeFileSync(path.join(this.outDir, `${this.name}.requests.json`), JSON.stringify(this.rec.requests.map((r) => ({ seq: r.seq, t: r.t, kind: r.kind, url: r.url, status: r.status, body: r.body, ...(this.live ? { responseText: String(r.responseText).slice(0, 20000) } : {}) })), null, 1));
    const result = { name: this.name, threadId: this.threadId, rollout, turns: this.turns, ...extra };
    fs.writeFileSync(path.join(this.outDir, `${this.name}.result.json`), JSON.stringify(result, null, 1));
    fs.rmSync(this.home, { recursive: true, force: true }); // also removes the copied auth.json
    return result;
  }
}

/** rollout: name + payload shape of compaction records, plus what the replacement history keeps. */
function rolloutCompaction(file) {
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l, i) => { try { return { line: i + 1, o: JSON.parse(l) }; } catch { return null; } }).filter(Boolean);
  const out = [];
  for (const { line, o } of rows) {
    const p = o.payload ?? {};
    if (o.type === "compacted") out.push({ line, type: "compacted", keys: Object.keys(p), replacementHistory: (p.replacement_history ?? []).map((h) => ({ type: h.type, role: h.role, markers: L.DESIGN_IDS.filter((id) => JSON.stringify(h).includes(`[probe-marker:${id}]`)), head: (Array.isArray(h.content) ? h.content.map((c) => c.text ?? "").join("") : "").slice(0, 60).replace(/\n/g, "\\n") })), messageHead: String(p.message ?? "").slice(0, 80) });
    else if (o.type === "event_msg" && /compact/i.test(JSON.stringify(p).slice(0, 200))) out.push({ line, type: `event_msg/${p.type}`, payload: p });
    else if (o.type === "response_item" && p.type === "compaction") out.push({ line, type: "response_item/compaction", keys: Object.keys(p) });
  }
  return { totalLines: rows.length, compactionRecords: out, firstTurnContextHasDevInstr: null };
}

const compact = (r) => ({ label: r.label, state: r.state, status: r.status, requests: r.requests.map((q) => ({ seq: q.seq, kind: q.kind, responded: q.responded, latest: q.inspect.latestDeveloperState, devStateCount: q.inspect.devStateCount, stateItems: q.inspect.stateItems, nonDev: q.inspect.nonDeveloperStateMentions, nItems: q.inspect.nItems })), compactionNotifs: r.compactionItems.map((x) => `${x.method}@${x.t.toFixed(1)}`) });
const fullLatest = (q, id) => q.inspect.latestDeveloperState?.id === id && q.inspect.latestDeveloperState.complete === true;

// ---------------------------------------------------------------- scenarios
async function scenImmediate(outDir) {
  const s = await new Session("immediate", outDir).init(); await s.open("A");
  const seq = [["T1 ON", "ON", 16], ["T2 OFF", "OFF"], ["T3 ON_EVAL", "ON_EVAL", 17], ["T4 OFF", "OFF"], ["T5 no ctx", undefined], ["T6 ON", "ON", 16], ["T7 no ctx", undefined, 16]];
  const checks = [];
  await s.start();
  for (const [label, state, tools] of seq) {
    const t = await s.turn(label, { state, tools });
    const q = t.requests.find((r) => r.kind === "normal");
    const expect = state ? L.DESIGN_ID_OF[state] : checks[checks.length - 1]?.expectId;
    checks.push({ label, expectId: expect, ok: q && fullLatest(q, expect), devStateCount: q?.inspect.devStateCount, order: q?.inspect.stateItems.map((i) => `${i.states.map((x) => x.id)}@${i.idx}:${i.role}`) });
  }
  return s.finish({ checks, pass: checks.every((c) => c.ok) });
}

async function runCompactionCase(outDir, state, { auto, tools }) {
  const name = `compaction-${auto ? "auto" : "manual"}-${state}`;
  const s = await new Session(name, outDir, { autoCompact: auto }).init(); await s.open("A");
  await s.start();
  await s.turn("T1 state", { state, tools }); await s.turn("T2 grow", { tools }); await s.turn("T3 grow", { tools });
  let after;
  if (auto) { s.rec.state.usageTokens = BIG_USAGE; await s.turn("T4 crosses limit", { tools }); after = [await s.turn("T5 post-compaction first", { tools }), await s.turn("T6 next", { tools })]; }
  else { await s.compactManual(); after = [await s.turn("T5 post-compaction first", { tools }), await s.turn("T6 next", { tools })]; }
  const expectId = L.DESIGN_ID_OF[state];
  const compactionRequests = s.rec.requests.filter((r) => r.kind === "compaction").length;
  const postNormal = after.flatMap((t) => t.requests.filter((r) => r.kind === "normal"));
  const verdict = { compactionRequests, firstAfter: postNormal[0] ? { latest: postNormal[0].inspect.latestDeveloperState, ok: fullLatest(postNormal[0], expectId) } : null, nextAfter: postNormal[1] ? { latest: postNormal[1].inspect.latestDeveloperState, ok: fullLatest(postNormal[1], expectId) } : null };
  verdict.pass = !!(compactionRequests > 0 && verdict.firstAfter?.ok && verdict.nextAfter?.ok);
  return s.finish({ state, auto, verdict, summary: s.turns.map(compact) });
}

async function scenCompaction(outDir) {
  const out = [];
  for (const auto of [false, true]) for (const state of ["OFF", "ON", "ON_EVAL"]) out.push(await runCompactionCase(outDir, state, { auto, tools: state === "ON" ? 16 : state === "ON_EVAL" ? 17 : undefined }));
  return out.map((r) => ({ name: r.name, verdict: r.verdict }));
}

async function scenRecompactOn(outDir) {
  const out = [];
  for (const [state, tools] of [["ON", 16], ["ON_EVAL", 17]]) {
    const s = await new Session(`recompact-${state}`, outDir, { autoCompact: true }).init(); await s.open("A"); await s.start();
    await s.turn("T1 OFF", { state: "OFF" }); await s.turn("T2 grow"); await s.turn("T3 grow");
    s.rec.state.usageTokens = BIG_USAGE; await s.turn("T4 crosses limit"); s.rec.state.usageTokens = 1;
    const post = await s.turn("T5 post-compaction (OFF should be gone)");
    // lilto starts a client per run: new process, resume with the MCP tool config for the ON run
    await s.closeProc(); await s.open("B"); await s.resume({ tools });
    const on = await s.turn(`T6 ${state} once after compaction`, { state, tools });
    const on2 = await s.turn("T7 no ctx", { tools });
    const q6 = on.requests.find((r) => r.kind === "normal"), q7 = on2.requests.find((r) => r.kind === "normal");
    const body6 = s.rec.requests.find((r) => r.seq === q6.seq).body;
    const ns = (body6.tools || []).filter((t) => t.type === "namespace" && /lilto_browser/.test(t.name)).map((t) => t.tools.map((x) => x.name));
    const st = await s.c.request("mcpServerStatus/list", { threadId: s.threadId, serverName: "lilto_browser" }, 30000).then((r) => Object.keys((r.data || []).find((x) => x.name === "lilto_browser")?.tools || {}).length).catch((e) => `err:${e.message}`);
    const id = L.DESIGN_ID_OF[state];
    const v = { latestIsTarget: fullLatest(q6, id), stillTargetNext: fullLatest(q7, id), devStateCountAfterOn: q6.inspect.devStateCount, requestToolCount: ns.map((x) => x.length), expectedTools: tools, evaluateInRequest: ns.some((x) => x.includes("browser_evaluate")), mcpStatusTools: st, oldOffItemsPresent: q6.inspect.stateItems.filter((i) => i.states.some((x) => x.id === "D_OFF")).length, offPresentRightAfterCompaction: post.requests.filter((r) => r.kind === "normal").some((r) => r.inspect.devStateCount > 0) };
    v.pass = v.latestIsTarget && v.stillTargetNext && v.devStateCountAfterOn === 1 && st === tools && v.requestToolCount[0] === tools;
    out.push(await s.finish({ state, verdict: v, summary: s.turns.map(compact) }));
  }
  return out.map((r) => ({ name: r.name, verdict: r.verdict }));
}

async function scenRestart(outDir) {
  const out = [];
  for (const [state, tools] of [["OFF", undefined], ["ON", 16], ["ON_EVAL", 17]]) {
    const s = await new Session(`restart-${state}`, outDir).init(); await s.open("A"); await s.start();
    const t1 = await s.turn("T1 state", { state, tools }); await s.turn("T2 no ctx", { tools });
    const before = s.turns[1].requests.find((r) => r.kind === "normal");
    await s.closeProc(); // client + App Server terminated
    await s.open("B"); await s.resume({ tools });
    const r1 = await s.turn("T3 after restart, no additionalContext", { tools });
    await s.closeProc(); await s.open("C"); await s.resume({ tools });
    const r2 = await s.turn("T4 after 2nd restart, no additionalContext", { tools });
    const q = [r1, r2].map((r) => r.requests.find((x) => x.kind === "normal"));
    const id = L.DESIGN_ID_OF[state];
    out.push(await s.finish({ state, verdict: { restoredAfterRestart1: fullLatest(q[0], id), restoredAfterRestart2: fullLatest(q[1], id), stateItemCount: { before: before.inspect.devStateCount, afterRestart1: q[0].inspect.devStateCount, afterRestart2: q[1].inspect.devStateCount }, noGrowth: q[0].inspect.devStateCount === before.inspect.devStateCount && q[1].inspect.devStateCount === before.inspect.devStateCount }, summary: s.turns.map(compact) }));
  }
  return out.map((r) => ({ name: r.name, verdict: r.verdict }));
}

module.exports = { Session, TEXTS, compact, fullLatest, rolloutCompaction, scenImmediate, scenCompaction, scenRecompactOn, scenRestart, AUTO_LIMIT, BIG_USAGE };

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const outDir = path.resolve(arg("out", "test/artifacts/compaction-probe")); fs.mkdirSync(outDir, { recursive: true });
  const which = arg("scenario", "all");
  const map = { immediate: scenImmediate, compaction: scenCompaction, "recompact-on": scenRecompactOn, restart: scenRestart };
  Object.assign(map, require("./app-server-compaction-probe-2.js")(module.exports));
  if (/^live/.test(which) || which === "all-live") Object.assign(map, require("./app-server-compaction-probe-live.js")(module.exports));
  for (const k of Object.keys(map)) if (/^live/.test(k) && !/^live/.test(which) && which !== "all-live") delete map[k];
  (async () => { const res = {}; for (const [k, f] of Object.entries(map)) { if (which !== "all" && which !== "all-live" && which !== k) continue; if (which === "all-live" && !/^live/.test(k)) continue; try { res[k] = await f(outDir); } catch (e) { res[k] = { error: String(e.stack || e).slice(0, 800) }; } console.error(`[done] ${k}`); } fs.writeFileSync(path.join(outDir, `summary-${which}.json`), JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, (k, v) => (k === "summary" ? undefined : v), 1).slice(0, 9000)); process.exit(0); })();
}
