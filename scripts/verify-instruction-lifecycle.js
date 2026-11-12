/**
 * Deterministic contract verification for the browser-instruction lifecycle (issue #43), model- and auth-free.
 * Real bundled Codex App Server + real lilto product adapter/store + local recording Responses server.
 *
 *   npm run build:unit && node scripts/verify-instruction-lifecycle.js [--out DIR]
 *
 * Results (JSON) go to test/artifacts/instruction-lifecycle/ by default. Exit code 1 on any failed check.
 * Every server/child/temp dir is released even when a scenario throws.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createLab, stateItems, BIG_USAGE } = require("./helpers/instruction-lifecycle-lab.js");

const outIndex = process.argv.indexOf("--out");
const outDir = path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(__dirname, "..", "test", "artifacts", "instruction-lifecycle"));
fs.mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
  if (!ok) console.error(`FAIL ${name}`, detail === undefined ? "" : JSON.stringify(detail));
}

const slim = (t) => ({ sent: t.sentAdditionalContext, stateItems: t.stateItemsInLastRequest, status: t.failedEvent ? t.failedEvent.type : "ok", thrown: t.thrown, interrupts: t.interrupts, compactionRequests: t.compactionRequests, normalAfterCompaction: t.normalAfterCompaction });

const OLD_ON_MARK = "OLD-ON-LEGACY-PROHIBITION";

/** Legacy thread: created like v0.1.17 did (ON instructions in thread/start developerInstructions), with a refusal in history. */
async function createLegacyThread(lab) {
  const { CodexAppServerClient } = lab.dist("main/codex-app-server-client.js");
  const { oldOnText } = require("./helpers/app-server-instruction-probe.js");
  const client = new CodexAppServerClient({ codexHomeDir: lab.home, codexCommand: require("./helpers/instruction-lifecycle-lab.js").BIN, invocationEnv: {} });
  await client.start();
  try {
    const started = await client.request("thread/start", { cwd: lab.ws, approvalPolicy: "never", sandbox: "danger-full-access", serviceName: "lilto-legacy", model: "probe-model", developerInstructions: `${oldOnText(false)}\n${OLD_ON_MARK}` });
    const threadId = started.thread.id;
    lab.recorder.state.script = () => ({ text: "Sorry, I cannot do that: lilto prohibits external Chromium/Chrome and the agent-browser CLI." });
    const turn = await client.request("turn/start", { threadId, input: [{ type: "text", text: "open a browser", text_elements: [] }], cwd: lab.ws, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, model: "probe-model" });
    for (;;) { const n = await client.nextNotification({ timeoutMs: 60000 }); if (n.method === "turn/completed") break; }
    lab.recorder.state.script = null;
    void turn;
    return threadId;
  } finally { client.close(); }
}

async function scenarioCounts() {
  const lab = await createLab({ label: "counts" });
  try {
    const threadId = await createLegacyThread(lab);
    const legacyRequest = lab.recorder.requests.at(-1);
    check("legacy thread: old ON instruction present, no lilto state item yet", JSON.stringify(legacyRequest.body.input).includes(OLD_ON_MARK) && stateItems(legacyRequest.body).length === 0);

    let store = lab.newStore();
    let thread = await lab.openThread(store, threadId);
    // [label, update, restartBefore, expected new items, expected cumulative]
    const plan = [
      ["unknown -> OFF", lab.update.off, false, 1, 1],
      ["OFF continues", lab.update.off, false, 0, 1],
      ["ON (evaluate OFF)", lab.update.on, false, 1, 2],
      ["ON continues", lab.update.on, false, 0, 2],
      ["evaluate ON", lab.update.onEval, false, 1, 3],
      ["evaluate ON continues", lab.update.onEval, false, 0, 3],
      ["OFF again", lab.update.off, false, 1, 4],
      ["restart, OFF continues", lab.update.off, true, 0, 4],
      ["OFF continues once more", lab.update.off, false, 0, 4]
    ];
    const rows = [];
    for (const [label, update, restart, expectedNew, expectedTotal] of plan) {
      if (restart) {
        lab.killAppServers();
        store = lab.newStore(); // a brand-new process: new store over the persisted file, new adapter
        thread = await lab.openThread(store, threadId);
      }
      const t = await lab.turn(thread, update);
      const row = { label, expectedNew, expectedTotal, ...slim(t), latestTextOk: t.lastRequestHasText(update.text), tools: update.state.evaluate ? /browser_evaluate/.test(t.lastRequestTools) : undefined };
      rows.push(row);
      check(`counts: ${label}: RPC additionalContext ${expectedNew ? "present" : "absent"}`, t.sentAdditionalContext === Boolean(expectedNew), row);
      check(`counts: ${label}: ${expectedTotal} state items in the model input`, t.stateItemsInLastRequest === expectedTotal, row);
      check(`counts: ${label}: latest state text is the current one`, t.lastRequestHasText(update.text), row);
      check(`counts: ${label}: turn completed`, !t.failedEvent && !t.thrown, row);
    }
    const last = lab.recorder.requests.filter((r) => r.kind === "normal").at(-1);
    check("counts: legacy ON text still in history (we append, never rewrite)", JSON.stringify(last.body.input).includes(OLD_ON_MARK));
    const items = stateItems(last.body);
    check("counts: state items are in send order (OFF, ON, ON_EVAL, OFF)", [lab.update.off, lab.update.on, lab.update.onEval, lab.update.off].every((u, i) => items[i]?.text.includes(u.text)), items.map((i) => i.idx));
    check("counts: no per-run secret in state text", !items.some((i) => /LILTO_BROWSER_BRIDGE_TOKEN|bridge/i.test(i.text)));
    return { threadId, rows, finalItems: items.length };
  } finally { await lab.dispose(); }
}

async function scenarioEvaluateWhileOff() {
  const lab = await createLab({ label: "eval-off" });
  try {
    const { resolveBrowserInstructionUpdate } = lab.sdkConfig;
    const store = lab.newStore();
    const thread = await lab.openThread(store);
    const a = await lab.turn(thread, resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: false }));
    const b = await lab.turn(thread, resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: true }));
    check("OFF: changing the evaluate setting does not send again", a.sentAdditionalContext && !b.sentAdditionalContext && b.stateItemsInLastRequest === 1, [slim(a), slim(b)]);
    const revised = { text: `${lab.update.off.text}\nrevised wording`, state: { ...lab.update.off.state, instructionDigest: "revised" } };
    const c = await lab.turn(thread, revised);
    const d = await lab.turn(thread, revised);
    check("text revision re-sends exactly once", c.sentAdditionalContext && !d.sentAdditionalContext && d.stateItemsInLastRequest === 2, [slim(c), slim(d)]);
  } finally { await lab.dispose(); }
}

async function scenarioFailures() {
  const out = {};
  // (a) interruption (user abort) while the model is working
  {
    const lab = await createLab({ label: "fail-abort" });
    try {
      const store = lab.newStore();
      const thread = await lab.openThread(store);
      const ok = await lab.turn(thread, lab.update.off);
      let release;
      lab.recorder.state.holdNext = () => new Promise((r) => { release = r; });
      const controller = new AbortController();
      const aborted = await lab.turn(thread, lab.update.off, { signal: controller.signal, beforeConsume: async () => { setTimeout(() => { controller.abort(); setTimeout(() => release?.(), 200); }, 300); } });
      lab.recorder.state.holdNext = null;
      const retry = await lab.turn(thread, lab.update.off);
      const after = await lab.turn(thread, lab.update.off);
      out.abort = [slim(ok), slim(aborted), slim(retry), slim(after)];
      check("interrupted turn: failure is reported", Boolean(aborted.failedEvent) || Boolean(aborted.thrown), out.abort);
      check("interrupted turn: next turn re-sends even though the state is unchanged", retry.sentAdditionalContext, out.abort);
      check("interrupted turn: then confirmed again (no send)", !after.sentAdditionalContext, out.abort);
    } finally { await lab.dispose(); }
  }
  // (b) App Server dies mid-turn, then a brand-new process (store reloaded from disk) continues
  {
    const lab = await createLab({ label: "fail-kill" });
    try {
      let store = lab.newStore();
      let thread = await lab.openThread(store);
      const first = await lab.turn(thread, lab.update.off);
      let release;
      lab.recorder.state.holdNext = () => new Promise((r) => { release = r; });
      const killed = await lab.turn(thread, lab.update.on, { beforeConsume: async () => { setTimeout(() => { lab.killAppServers(); release?.(); }, 400); } });
      lab.recorder.state.holdNext = null;
      const diskRecord = JSON.parse(fs.readFileSync(lab.stateFile, "utf8")).namespaces[lab.namespace];
      store = lab.newStore();
      thread = await lab.openThread(store, first.threadId);
      const resumed = await lab.turn(thread, lab.update.off);
      out.kill = { first: slim(first), killed: slim(killed), disk: Object.values(diskRecord).map((r) => r.status), resumed: slim(resumed) };
      check("server death mid-turn: reported as failure", Boolean(killed.failedEvent) || Boolean(killed.thrown), out.kill);
      check("server death mid-turn: nothing is trusted afterwards (OFF re-announced although OFF was confirmed earlier)", resumed.sentAdditionalContext && resumed.lastRequestHasText(lab.update.off.text), out.kill);
    } finally { await lab.dispose(); }
  }
  // (c) state file cannot be written: no turn at all
  {
    const lab = await createLab({ label: "fail-store" });
    try {
      const io = { readFile: async () => null, writeFileAtomic: async () => { throw new Error("read-only disk"); } };
      const thread = await lab.openThread(lab.newStore(io));
      const before = lab.recorder.requests.length;
      const t = await lab.turn(thread, lab.update.off);
      out.store = slim(t);
      check("unwritable store: no turn/start and no model request", t.turnStartCount === 0 && lab.recorder.requests.length === before && Boolean(t.thrown), out.store);
    } finally { await lab.dispose(); }
  }
  // (d) crash-pending: begin() persisted, process died before the turn settled
  {
    const lab = await createLab({ label: "fail-pending" });
    try {
      const store = lab.newStore();
      const thread = await lab.openThread(store);
      const first = await lab.turn(thread, lab.update.off);
      await lab.newStore().begin(lab.namespace, first.threadId, lab.update.off.state); // the app died right after begin()
      const next = await lab.turn(await lab.openThread(lab.newStore(), first.threadId), lab.update.off);
      out.pending = [slim(first), slim(next)];
      check("pending left by a crash reads back as unknown (re-sent)", next.sentAdditionalContext, out.pending);
    } finally { await lab.dispose(); }
  }
  return out;
}

async function scenarioConflict() {
  const lab = await createLab({ label: "conflict" });
  try {
    const store = lab.newStore();
    const first = await lab.openThread(store);
    const seed = await lab.turn(first, lab.update.off);
    const a = await lab.openThread(store, seed.threadId);
    const b = await lab.openThread(store, seed.threadId); // another conversation resolving to the same backend thread
    let release;
    lab.recorder.state.holdNext = () => new Promise((r) => { release = r; });
    const running = lab.turn(a, lab.update.off, { beforeConsume: async () => { setTimeout(() => release?.(), 1500); } });
    await new Promise((r) => setTimeout(r, 500));
    const refused = await lab.turn(b, lab.update.off, { timeoutMs: 5000 });
    await running;
    lab.recorder.state.holdNext = null;
    check("same backend thread: concurrent run is refused", /使用中/.test(refused.thrown ?? "") && refused.turnStartCount === 0, slim(refused));
    const after = await lab.turn(b, lab.update.off);
    check("same backend thread: runs again after the first turn ended", !after.thrown && !after.sentAdditionalContext, slim(after));
  } finally { await lab.dispose(); }
}

async function scenarioCompaction() {
  const out = {};
  const toolScript = (needle) => (rec) => {
    const input = rec.body?.input ?? []; const last = input[input.length - 1] ?? {};
    const text = Array.isArray(last.content) ? last.content.map((c) => c.text ?? "").join("") : "";
    return last.role === "user" && text.includes(needle) ? { toolCall: { name: "exec_command", args: { cmd: "echo mid-turn-tool", yield_time_ms: 1000 } } } : null;
  };
  for (const variant of ["pre-turn", "mid-turn"]) {
    const lab = await createLab({ autoCompact: true, label: `compaction-${variant}` });
    try {
      const store = lab.newStore();
      const thread = await lab.openThread(store);
      const rows = [];
      rows.push(await lab.turn(thread, lab.update.off));
      rows.push(await lab.turn(thread, lab.update.off));
      lab.recorder.state.usageTokens = BIG_USAGE;
      let crossing;
      if (variant === "mid-turn") {
        lab.recorder.state.script = toolScript("midturn-tool");
        crossing = await lab.turn(thread, lab.update.off, { prompt: "midturn-tool please" });
      } else {
        rows.push(await lab.turn(thread, lab.update.off, { prompt: "this turn crosses the limit" }));
        crossing = await lab.turn(thread, lab.update.off, { prompt: "pre-turn compaction happens here" });
      }
      lab.recorder.state.script = null;
      lab.recorder.state.usageTokens = 1;
      // The stop at compaction START discards that compaction, so the retry turn compacts again (it must not be stopped again).
      const retry = await lab.turn(thread, lab.update.off);
      const resend = await lab.turn(thread, lab.update.off);
      const quiet = await lab.turn(thread, lab.update.off);
      out[variant] = { crossing: slim(crossing), retry: { ...slim(retry), latestOk: retry.lastRequestHasText(lab.update.off.text) }, resend: slim(resend), quiet: slim(quiet) };
      check(`${variant}: compaction happened and the turn was stopped by interrupt`, crossing.compactionRequests >= 1 && crossing.interrupts >= 1, out[variant]);
      check(`${variant}: no normal model request after the compaction in the same turn`, crossing.normalAfterCompaction === 0, out[variant]);
      check(`${variant}: stop is reported with the retry message`, /自動圧縮/.test(crossing.failedEvent?.error?.message ?? ""), out[variant]);
      check(`${variant}: retry turn re-sends the full latest state and it is in the model input after its compaction`, retry.sentAdditionalContext && retry.compactionRequests >= 1 && retry.lastRequestHasText(lab.update.off.text), out[variant]);
      check(`${variant}: retry turn is not stopped again (no endless loop) and completes`, retry.interrupts === 0 && !retry.failedEvent && !retry.thrown, out[variant]);
      check(`${variant}: a turn that saw a compaction is never confirmed: one more (bounded) re-send, then confirmed`, resend.sentAdditionalContext && resend.compactionRequests === 0 && !quiet.sentAdditionalContext, out[variant]);
    } finally { await lab.dispose(); }
  }
  return out;
}

async function main() {
  const probe = await createLab({ label: "version" });
  const meta = { codex: probe.version, platform: `${process.platform}-${process.arch}`, node: process.version, startedAt: new Date().toISOString() };
  await probe.dispose();
  const detail = {};
  for (const [name, fn] of [["counts", scenarioCounts], ["evaluateWhileOff", scenarioEvaluateWhileOff], ["failures", scenarioFailures], ["conflict", scenarioConflict], ["compaction", scenarioCompaction]]) {
    try { detail[name] = await fn(); } catch (error) { check(`scenario ${name} threw`, false, String(error?.stack ?? error)); }
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ meta, total: results.length, failed: failed.length, results, detail }, null, 1));
  console.log(`${meta.codex} ${meta.platform}: ${results.length - failed.length}/${results.length} checks passed -> ${path.join(outDir, "result.json")}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
