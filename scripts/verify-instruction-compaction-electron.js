/**
 * (The recording server runs in its own process so main-process stalls do not also stall the server's timestamps.)
 * Does the compaction-START interrupt land in time inside a REAL Electron main process that is busy? (issue #43, task 7)
 *
 * Runs the product adapter (createCodexThreadFromAppServer) in Electron main against the bundled App Server and a
 * local recording server, while main is stalled by synchronous work (busy loops on a timer, the way a heavy IPC /
 * rendering burst would) and a real BrowserWindow is live. For each condition it counts turns where the model
 * received any normal request AFTER the compaction request in the same turn (= the interrupt came too late).
 *
 *   npm run build && node_modules/.bin/electron scripts/verify-instruction-compaction-electron.js [--n 10] [--out DIR]
 *
 * Deterministic compaction delay 0 ms is the harshest case (the budget is just the local round trip); real providers
 * measured ~10 s for the compaction request, so the real budget is far larger.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createLab, BIG_USAGE } = require("./helpers/instruction-lifecycle-lab.js");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const N = Number(arg("--n", 10));
const outDir = path.resolve(arg("--out", path.join(__dirname, "..", "test", "artifacts", "instruction-compaction-electron")));
fs.mkdirSync(outDir, { recursive: true });

/** Block the event loop for `stallMs` every `periodMs` (0 = idle main). Returns a stopper. */
function loadMain(stallMs, periodMs) {
  if (!stallMs) return () => {};
  const timer = setInterval(() => { const end = Date.now() + stallMs; while (Date.now() < end) { /* busy */ } }, periodMs);
  return () => clearInterval(timer);
}

async function runOne({ variant, compactionDelayMs, stallMs }) {
  const lab = await createLab({ autoCompact: true, label: "electron", recorderProcess: true });
  try {
    const store = lab.newStore();
    const thread = await lab.openThread(store);
    await lab.turn(thread, lab.update.off);
    await lab.turn(thread, lab.update.off);
    lab.recorder.state.usageTokens = BIG_USAGE;
    lab.recorder.state.compactionDelayMs = compactionDelayMs;
    if (variant === "mid-turn") lab.recorder.state.scriptSpec = { toolCallNeedle: "midturn-tool" };
    else await lab.turn(thread, lab.update.off); // crosses the limit; the next turn compacts before it starts
    const stop = loadMain(stallMs, 3);
    const rpcBefore = lab.rpc.length;
    const reqBefore = lab.recorder.requests.length;
    let t;
    try { t = await lab.turn(thread, lab.update.off, { prompt: variant === "mid-turn" ? "midturn-tool please" : "pre-turn compaction here" }); } finally { stop(); }
    lab.recorder.state.scriptSpec = null;
    const reqs = lab.recorder.requests.slice(reqBefore);
    const comp = reqs.find((r) => r.kind === "compaction");
    const interrupt = lab.rpc.slice(rpcBefore).find((c) => c.method === "turn/interrupt");
    return {
      variant, compactionDelayMs, stallMs,
      compacted: Boolean(comp),
      interrupted: Boolean(interrupt),
      stoppedInTime: Boolean(comp) && Boolean(interrupt) && t.normalAfterCompaction === 0,
      normalAfterCompaction: t.normalAfterCompaction,
      interruptAfterCompactionRequestMs: comp && interrupt ? interrupt.t - comp.wall : null
    };
  } finally { await lab.dispose(); }
}

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ width: 900, height: 600, show: true });
  await window.loadURL("data:text/html,<body>electron main under load</body>");
  const conditions = [];
  for (const variant of ["pre-turn", "mid-turn"]) {
    for (const compactionDelayMs of [0, 50, 500]) {
      for (const stallMs of [0, 40, 150]) conditions.push({ variant, compactionDelayMs, stallMs });
    }
  }
  const rows = [];
  const summary = [];
  for (const c of conditions) {
    const runs = [];
    for (let i = 0; i < N; i++) runs.push(await runOne(c));
    const compacted = runs.filter((r) => r.compacted).length;
    const ok = runs.filter((r) => r.stoppedInTime).length;
    const lat = runs.map((r) => r.interruptAfterCompactionRequestMs).filter((x) => x !== null).sort((a, b) => a - b);
    const row = { ...c, n: N, compacted, stoppedInTime: ok, interruptLatencyMs: { min: lat[0] ?? null, median: lat[Math.floor(lat.length / 2)] ?? null, max: lat.at(-1) ?? null } };
    summary.push(row); rows.push(...runs);
    console.log(JSON.stringify(row));
  }
  const meta = { electron: process.versions.electron, node: process.versions.node, platform: `${process.platform}-${process.arch}`, codex: require("./helpers/instruction-lifecycle-lab.js").codexVersion(), n: N };
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ meta, summary, runs: rows }, null, 1));
  window.destroy();
  app.exit(0);
}
main().catch((error) => { console.error(error); app.exit(1); });
