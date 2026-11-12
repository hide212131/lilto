/**
 * Real-model verification of the browser-instruction lifecycle through the PRODUCT path (issue #43, task 9).
 * NOT part of CI: needs ~/.codex/auth.json (copied into an isolated CODEX_HOME that is deleted afterwards).
 * Everything else is isolated too: temp CODEX_HOME / workspace / state file, a local page with a server-side hit log,
 * and a fake external `agent-browser` CLI that stands in for "the normally available browser route".
 * The user's real conversations/threads are never opened.
 *
 *   npm run build:unit && node scripts/verify-instruction-lifecycle-live.js [--rounds 3] [--out DIR] [--only rounds|compaction]
 *
 * Judged by the page's hit log (which route reached it), the real model request bodies (count of lilto state items),
 * and the RPC (additionalContext present/absent), never by what the model says.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLab, stateItems } = require("./helpers/instruction-lifecycle-lab.js");
const { startPage, installFakeExternalBrowser } = require("./helpers/app-server-instruction-probe-live.js");
const { oldOnText, Probe, makeHome } = require("./helpers/app-server-instruction-probe.js");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const ROUNDS = Number(arg("--rounds", 3));
const ONLY = arg("--only", "all");
const MODEL = process.env.PROBE_MODEL_LIVE || "gpt-6.1-sol";
const outDir = path.resolve(arg("--out", path.join(__dirname, "..", "test", "artifacts", "instruction-lifecycle-live")));
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(path.join(os.homedir(), ".codex", "auth.json"))) { console.error("no ~/.codex/auth.json: not authenticated"); process.exit(2); }

const results = [];
function check(name, ok, detail) { results.push({ name, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }); if (!ok) console.error(`FAIL ${name}`, JSON.stringify(detail)?.slice(0, 600)); }

const PROMPT = (base, label) => `Use a browser to open ${base}/page?s=${label}, read the Nonce shown on the page, click the "Confirm" link/button, and reply with the exact "CONFIRMED code=..." text the page returns plus the Nonce.`;
const EXTERNAL_CMD = /(curl|wget|chrom|playwright|agent-browser|puppeteer|selenium|open\s+-a|\bopen\s+http)/i;
const PROHIBITION = /(prohibit|forbidden|not allowed|must not|cannot|can't|unable|禁止|できません|使用しない|使えません|許可されて)/i;

function observe(t, page, armed) {
  const items = t.events.filter((e) => e.type === "item.completed").map((e) => e.item);
  const msg = items.filter((i) => i.type === "agent_message").map((i) => i.text).join("\n");
  const cmds = items.filter((i) => i.type === "command_execution").map((i) => i.command);
  const mcp = items.filter((i) => i.type === "mcp_tool_call").map((i) => ({ server: i.server, tool: i.tool }));
  return {
    stubHit: page.hits.some((h) => h.ua === "lilto-stub" && h.confirmed),
    externalConfirm: page.hits.some((h) => h.ua !== "lilto-stub" && h.confirmed),
    externalAny: page.hits.some((h) => h.ua !== "lilto-stub"),
    codeReported: msg.includes(armed.code),
    liltoCalls: mcp.filter((m) => m.server === "lilto_browser").map((m) => m.tool),
    externalCmds: cmds.filter((c) => EXTERNAL_CMD.test(c)),
    refusal: PROHIBITION.test(msg) && !msg.includes(armed.code),
    finalMessage: msg.slice(0, 400)
  };
}

/** Legacy thread exactly like v0.1.17 made: ON instructions in thread/start, tools present, then a refusal in history. */
async function createLegacyThread(lab, page) {
  const { CodexAppServerClient } = lab.dist("main/codex-app-server-client.js");
  const probe = new Probe({ home: lab.home, ws: lab.ws, recorder: null, outDir, model: MODEL, env: {} });
  const client = new CodexAppServerClient({ codexHomeDir: lab.home, codexCommand: require("./helpers/instruction-lifecycle-lab.js").BIN, invocationEnv: {} });
  await client.start();
  try {
    const launch = lab.launchFor(lab.update.on);
    const config = lab.sdkConfig.withBrowserMcpConfig(undefined, launch);
    const started = await client.request("thread/start", { cwd: lab.ws, approvalPolicy: "never", sandbox: "danger-full-access", serviceName: "lilto-legacy", model: MODEL, config, developerInstructions: oldOnText(false) }, 60000);
    const threadId = started.thread.id;
    const turn = async (text) => {
      const out = await client.request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }], cwd: lab.ws, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, model: MODEL, config }, 60000);
      const items = [];
      for (;;) {
        const n = await client.nextNotification({ timeoutMs: 300000 });
        if (n.method === "item/completed" && n.params?.item) items.push(n.params.item);
        if (n.method === "turn/completed" && n.params?.turn?.id === out.turn.id) return items;
      }
    };
    const armed = page.arm();
    await turn(PROMPT(page.base, "S0-legacy-ON")); // legacy ON working normally through lilto_browser
    // ... and the refusal the old prohibition produced when the browser integration was switched OFF
    const refusalItems = await turn("Reply with exactly this sentence and nothing else: Sorry, I cannot do that: lilto prohibits external Chromium/Chrome, the agent-browser CLI and other Playwright browsers.");
    void armed; void refusalItems; void probe;
    return threadId;
  } finally { client.close(); }
}

async function rounds() {
  const out = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const page = await startPage();
    const pre = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-live-bin-"));
    const bin = installFakeExternalBrowser(pre);
    const lab = await createLab({ label: `live-r${round}`, live: { model: MODEL }, extraPath: [bin] });
    lab.pageBase = page.base;
    const rr = { round, stages: [] };
    try {
      const legacyThread = await createLegacyThread(lab, page);
      let store = lab.newStore();
      let thread = await lab.openThread(store, legacyThread);
      const sequence = [
        ["S1-OFF", lab.update.off, "OFF", { newItems: 1 }],
        ["S2-OFF-unchanged", lab.update.off, "OFF", { newItems: 0 }],
        ["S3-ON", lab.update.on, "ON", { newItems: 1 }],
        ["S4-ON-unchanged", lab.update.on, "ON", { newItems: 0 }],
        ["S5-restart-ON-evaluate", lab.update.onEval, "ON", { newItems: 1, restart: true }],
        ["S6-OFF", lab.update.off, "OFF", { newItems: 1 }],
        ["S7-ON-again", lab.update.on, "ON", { newItems: 1 }]
      ];
      let cumulative = 0;
      for (const [label, update, expectRoute, opts] of sequence) {
        if (opts.restart) { lab.killAppServers(); store = lab.newStore(); thread = await lab.openThread(store, legacyThread); }
        const armed = page.arm();
        const t = await lab.turn(thread, update, { prompt: PROMPT(page.base, label), timeoutMs: 300000 });
        cumulative += opts.newItems;
        const o = observe(t, page, armed);
        const routeOk = expectRoute === "OFF"
          ? o.externalConfirm && o.codeReported && o.liltoCalls.length === 0 && !o.refusal
          : o.stubHit && o.liltoCalls.some((tool) => /acquire/.test(tool)) && o.codeReported && !o.externalAny && o.externalCmds.length === 0;
        const itemsOk = t.stateItemsInLastRequest === cumulative && t.sentAdditionalContext === Boolean(opts.newItems) && t.lastRequestHasText(update.text);
        const stage = { label, threadId: t.threadId, expectRoute, stateItems: t.stateItemsInLastRequest, expectedItems: cumulative, sentAdditionalContext: t.sentAdditionalContext, routeOk, itemsOk, ...o, hits: page.hits.map((h) => `${h.path} ua=${h.ua} via=${h.via ?? ""} confirmed=${!!h.confirmed}`) };
        rr.stages.push(stage);
        check(`round ${round} ${label}: route (${expectRoute})`, routeOk, stage);
        check(`round ${round} ${label}: state items ${cumulative} in the real model input, additionalContext ${opts.newItems ? "sent" : "absent"}`, itemsOk, stage);
        check(`round ${round} ${label}: same thread id`, t.threadId === legacyThread, stage);
      }
    } catch (error) { check(`round ${round} threw`, false, String(error?.stack ?? error).slice(0, 600)); }
    finally {
      fs.writeFileSync(path.join(outDir, `rounds-${round}.json`), JSON.stringify({ model: MODEL, ...rr }, null, 1));
      await lab.dispose(); page.server.close(); fs.rmSync(pre, { recursive: true, force: true });
    }
    out.push(rr);
  }
  return out;
}

async function compaction() {
  const page = await startPage();
  const lab = await createLab({ label: "live-compaction", autoCompact: true, live: { model: MODEL, autoLimit: Number(process.env.LIVE_LIMIT || 17500) } });
  lab.pageBase = page.base;
  const log = [];
  try {
    const thread = await lab.openThread(lab.newStore());
    const quiet = "Reply with exactly one word: ok";
    let stoppedTurn = null;
    for (let i = 1; i <= 8; i++) {
      const t = await lab.turn(thread, lab.update.off, { prompt: quiet, timeoutMs: 300000 });
      const row = { turn: i, sent: t.sentAdditionalContext, stateItems: t.stateItemsInLastRequest, compactionRequests: t.compactionRequests, interrupts: t.interrupts, normalAfterCompaction: t.normalAfterCompaction, stopped: /自動圧縮/.test(t.failedEvent?.error?.message ?? ""), latestOk: t.lastRequestHasText(lab.update.off.text) };
      log.push(row);
      if (row.stopped) { stoppedTurn = row; break; }
    }
    check("live: a real auto compaction occurred and the turn was stopped by interrupt", Boolean(stoppedTurn), log);
    if (stoppedTurn) {
      check("live: no normal model request after the compaction in the stopped turn", stoppedTurn.normalAfterCompaction === 0, log);
      // With the artificially tight limit EVERY following turn compacts as well: each one carries the update (unknown after a
      // stop/compaction), compacts before its own user message, and must run through without being stopped.
      const followUps = [];
      for (let i = 0; i < 3; i++) followUps.push(await lab.turn(thread, lab.update.off, { prompt: quiet, timeoutMs: 300000 }));
      const rows = followUps.map((t) => ({ sent: t.sentAdditionalContext, stateItems: t.stateItemsInLastRequest, compactionRequests: t.compactionRequests, interrupts: t.interrupts, latestOk: t.lastRequestHasText(lab.update.off.text), failed: Boolean(t.failedEvent || t.thrown) }));
      log.push({ followUps: rows });
      check("live: after the stop, every follow-up turn sends the state, is not stopped again, completes, and the state is in the model input", rows.every((r) => r.sent && r.interrupts === 0 && !r.failed && r.latestOk), log);
      const compReqs = lab.recorder.requests.filter((r) => /compaction/.test(r.kind));
      log.push({ compactionRequestStatuses: compReqs.map((r) => ({ kind: r.kind, status: r.status, ms: null })) });
    }
    const durations = lab.timeline.filter((e) => e.src === "model" && e.kind === "compaction").map((e) => ({ seq: e.seq, t: e.t, done: lab.timeline.find((x) => x.src === "model" && x.seq === e.seq && x.kind === "response-completed")?.t }));
    log.push({ compactionRequestDurationsMs: durations.map((d) => (d.done ? +(d.done - d.t).toFixed(0) : null)) });
  } catch (error) { check("compaction scenario threw", false, String(error?.stack ?? error).slice(0, 600)); }
  finally {
    fs.writeFileSync(path.join(outDir, "compaction.json"), JSON.stringify({ model: MODEL, log }, null, 1));
    await lab.dispose(); page.server.close();
  }
  return log;
}

(async () => {
  const meta = { codex: require("./helpers/instruction-lifecycle-lab.js").codexVersion(), model: MODEL, platform: `${process.platform}-${process.arch}`, node: process.version, startedAt: new Date().toISOString() };
  const detail = {};
  if (ONLY === "all" || ONLY === "rounds") detail.rounds = await rounds();
  if (ONLY === "all" || ONLY === "compaction") detail.compaction = await compaction();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ meta, total: results.length, failed: failed.length, results: results.map((r) => ({ name: r.name, ok: r.ok })) }, null, 1));
  console.log(`${meta.model} ${meta.codex}: ${results.length - failed.length}/${results.length} checks passed -> ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
