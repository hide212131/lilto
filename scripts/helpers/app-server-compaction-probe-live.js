/**
 * Live half: real model (gpt-6.1-sol by default) with the REAL compaction path. A recording forwarding proxy sits in front of
 * the ChatGPT backend (provider named "OpenAI" so remote compaction is eligible; websockets off) so real request bodies are
 * judged structurally, and behaviour is judged from a local page's server-side hit log. Copies ONLY ~/.codex/auth.json into the
 * isolated CODEX_HOME and removes it afterwards (Session.finish deletes the whole home).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("./compaction-probe-lib.js");
const LiveH = require("./app-server-instruction-probe-live.js");

module.exports = (P) => {
  const { Session, TEXTS, compact, fullLatest, rolloutCompaction } = P;
  const MODEL = process.env.PROBE_MODEL_LIVE || "gpt-6.1-sol";
  const N = Number(process.env.PROBE_N_LIVE || 3);
  const normalReq = (t) => t.requests.filter((r) => r.kind === "normal");
  const mentionsBrowser = (body) => (body?.input ?? []).map((it, idx) => ({ idx, role: it.role, type: it.type, text: Array.isArray(it.content) ? it.content.map((c) => c.text ?? "").join("\n") : "" })).filter((i) => i.role !== "developer" && /embedded.browser|lilto_browser|browser integration/i.test(i.text) && !/probe-marker/.test(i.text)).map((i) => ({ idx: i.idx, role: i.role, head: i.text.slice(0, 160).replace(/\n/g, "\\n") }));
  const cleanupAuth = (s) => { try { fs.rmSync(path.join(s.home, "auth.json"), { force: true }); } catch { /* */ } };
  const sess = (name, outDir, o = {}) => new Session(name, outDir, { autoCompact: true, ...o, live: { model: MODEL, autoLimit: 3000, ...(o.live ?? {}) } });
  const PROMPT = "Reply with exactly one word: ok";

  // ---- structural retention with the real compaction path (auto + manual), restart included
  async function scenLiveStructural(outDir) {
    const out = [];
    for (const mode of ["auto", "manual"]) for (const [state, tools] of [["OFF", undefined], ["ON", 16], ["ON_EVAL", 17]]) for (let i = 1; i <= N; i++) {
      const s = await sess(`live-struct-${mode}-${state}-${i}`, outDir, { autoCompact: mode === "auto" }).init();
      let result;
      try {
        await s.open("A"); await s.start({ tools });
        await s.turn("T1 state", { state, tools, prompt: PROMPT }); await s.turn("T2", { tools, prompt: PROMPT });
        if (mode === "manual") await s.compactManual();
        const post1 = await s.turn("T3 first after compaction", { tools, prompt: PROMPT });
        const post2 = await s.turn("T4 next", { tools, prompt: PROMPT });
        await s.closeProc(); await s.open("B"); await s.resume({ tools });
        const rs = await s.turn("T5 after restart (no ctx)", { tools, prompt: PROMPT });
        const id = L.DESIGN_ID_OF[state];
        const reqs = s.rec.requests;
        const comp = reqs.filter((r) => /compaction/.test(r.kind));
        const q = [post1, post2, rs].map((t) => normalReq(t).slice(-1)[0]);
        const allNormal = [s.turns.flatMap((t) => normalReq(t))].flat();
        const firstPostIdx = s.turns.findIndex((t) => t.compactionItems.length);
        result = await s.finish({ mode, state, verdict: {
          compactionRequests: comp.map((r) => ({ kind: r.kind, url: r.url, status: r.status })),
          compactionItemNotifs: s.turns.map((t) => t.compactionItems.length).reduce((a, b) => a + b, 0),
          firstAfterCompaction: q[0] ? { latest: q[0].inspect.latestDeveloperState, ok: fullLatest(q[0], id), devStateCount: q[0].inspect.devStateCount, hasCompactionItem: q[0].inspect.hasCompactionItem, roles: q[0].inspect.roles } : null,
          nextAfter: q[1] ? { latest: q[1].inspect.latestDeveloperState, ok: fullLatest(q[1], id), devStateCount: q[1].inspect.devStateCount } : null,
          afterRestart: q[2] ? { latest: q[2].inspect.latestDeveloperState, ok: fullLatest(q[2], id), devStateCount: q[2].inspect.devStateCount } : null,
          summaryMentionsBrowserNonDeveloper: mentionsBrowser(s.rec.requests.find((r) => r.seq === q[0]?.seq)?.body),
          firstPostTurn: firstPostIdx
        }, summary: s.turns.map(compact) });
        result.verdict.pass = !!(result.verdict.compactionRequests.length && result.verdict.firstAfterCompaction?.ok && result.verdict.nextAfter?.ok);
        fs.writeFileSync(path.join(outDir, `${s.name}.result.json`), JSON.stringify(result, null, 1));
      } catch (e) { cleanupAuth(s); result = { name: s.name, error: String(e.stack || e).slice(0, 600) }; try { await s.finish({ error: result.error }); } catch { /* */ } }
      out.push({ name: result.name, mode, state, verdict: result.verdict, error: result.error });
    }
    return out;
  }

  // ---- behaviour: legacy ON thread -> OFF -> auto compaction -> same browser task, no resend
  async function scenLiveBehavior(outDir) {
    const page = await LiveH.startPage();
    const out = [];
    try {
      for (let i = Number(process.env.PROBE_ROUND_START || 1); i <= N; i++) for (const target of ["OFF", "ON"]) {
        const s = await sess(`live-behavior-${target}-${i}`, outDir, { autoCompact: false }).init();
        s.pageBase = page.base;
        const bin = LiveH.installFakeExternalBrowser(s.home);
        s.live.env = { PATH: `${bin}:${process.env.PATH}` };
        const stages = [];
        const task = async (label, stage, o) => {
          const armed = page.arm();
          const t = await s.turn(label, { tools: 16, prompt: LiveH.prompt(page.base, label), timeoutMs: 240000, ...o });
          const j = LiveH.judge(stage, { events: t.items, status: t.status }, page, armed);
          stages.push({ label, ...j, hits: page.hits.map((h) => `${h.path} ua=${h.ua} confirmed=${!!h.confirmed}`), latest: normalReq(t).slice(-1)[0]?.inspect.latestDeveloperState ?? null, devStateCount: normalReq(t).slice(-1)[0]?.inspect.devStateCount, oldOnDev: normalReq(t).slice(-1)[0]?.inspect.stateItems.filter((x) => x.role === "developer" && x.states.some((y) => y.id === "OLD_ON")).length, compactions: t.compactionItems.length / 2 });
          return t;
        };
        try {
          await s.open("A"); await s.start({ tools: 16, developerInstructions: TEXTS.OLD_ON });
          await task("S0-legacy-ON", "SETUP", {});
          await task("S1-OFF", "OFF", { state: "OFF", tools: 16 });
          // force real automatic compaction: lower the limit for the next processes (config is read at process start)
          await s.closeProc();
          fs.appendFileSync(path.join(s.home, "config.toml"), "");
          const cfg = fs.readFileSync(path.join(s.home, "config.toml"), "utf8");
          fs.writeFileSync(path.join(s.home, "config.toml"), `model_auto_compact_token_limit = ${process.env.LIVE_BEH_LIMIT || 3000}\n${cfg}`);
          await s.open("B"); await s.resume({ tools: 16 });
          if (target === "OFF") {
            await task("S2-after-auto-compaction-no-resend (OFF task)", "OFF", { tools: 16 });
            await task("S3-resend-OFF-recovery", "OFF", { state: "OFF", tools: 16 });
          } else {
            await task("S2-after-auto-compaction-ON-sent-once", "ON", { state: "ON", tools: 16 });
            await task("S3-ON-no-resend", "ON", { tools: 16 });
          }
        } catch (e) { stages.push({ label: "error", error: String(e.message).slice(0, 300), pass: false }); }
        const r = await s.finish({ target, stages });
        out.push({ name: s.name, target, stages: stages.map((x) => ({ label: x.label, pass: x.pass, status: x.status, latest: x.latest?.id, oldOnDev: x.oldOnDev, compactions: x.compactions, codeReported: x.codeReported, externalConfirm: x.externalConfirm, stubHit: x.stubHit, refusal: x.refusalHeuristic, msg: (x.finalMessage || "").slice(0, 160) })) });
      }
    } finally { page.server.close(); }
    return out;
  }

  // ---- real compaction latency: can we stop the turn before the post-compaction continuation?
  async function scenLiveInterrupt(outDir) {
    const out = [];
    for (let i = 1; i <= N; i++) {
      const s = await sess(`live-interrupt-${i}`, outDir, { autoCompact: true, live: { autoLimit: 17500 } }).init();
      try {
        await s.open("A"); await s.start({});
        await s.turn("T1 OFF", { state: "OFF", prompt: PROMPT });
        // a long-ish tool output pushes real usage past the limit inside a single turn -> mid-turn compaction
        const t = await s.turn("T2 tool turn", { prompt: "Run this exact shell command and then reply ok: python3 -c \"import random;print(' '.join(str(random.random()) for _ in range(4000)))\"", timeoutMs: 240000, onNote: (n) => (n.method === "item/started" && n.params?.item?.type === "contextCompaction" ? { reason: "interrupt on item/started contextCompaction" } : null) });
        const reqs = s.rec.requests;
        const compIdx = reqs.findIndex((r) => /compaction/.test(r.kind));
        const normalAfter = compIdx >= 0 ? reqs.slice(compIdx + 1).filter((r) => r.kind === "normal") : [];
        const nxt = await s.turn("T3 resend OFF", { state: "OFF", prompt: PROMPT });
        const nq = normalReq(nxt).slice(-1)[0];
        const r = { i, turnStatus: t.status, sawCompaction: compIdx >= 0, compactionKind: reqs[compIdx]?.kind, compactionUrl: reqs[compIdx]?.url, interruptMsAfterBegin: t.interrupted ? +(t.interrupted.at - s.timeline.filter((e) => e.kind === "turn-begin" && e.label === t.label).pop().t).toFixed(0) : null, interruptRpcOk: !!t.interrupted?.rpcDone && !t.interrupted?.err, normalRequestsAfterCompactionRequest: normalAfter.length, stoppedBeforeContinuation: compIdx >= 0 && t.status === "interrupted" && normalAfter.length === 0, nextTurnRecovered: !!nq && fullLatest(nq, "D_OFF"), compactionItemNotifs: t.compactionItems.map((x) => x.method) };
        await s.finish({ r }); out.push(r);
      } catch (e) { out.push({ i, error: String(e.stack || e).slice(0, 400) }); try { await s.finish({}); } catch { /* */ } }
    }
    return out;
  }

  // ---- real provider: restart retention WITHOUT compaction (immediate retention + restart restore)
  async function scenLiveRestart(outDir) {
    const out = [];
    for (const [state, tools] of [["OFF", undefined], ["ON", 16], ["ON_EVAL", 17]]) for (let i = 1; i <= N; i++) {
      const s = await sess(`live-restart-${state}-${i}`, outDir, { autoCompact: false }).init();
      try {
        await s.open("A"); await s.start({ tools });
        const t1 = await s.turn("T1 state", { state, tools, prompt: PROMPT }); const t2 = await s.turn("T2 no ctx", { tools, prompt: PROMPT });
        await s.closeProc(); await s.open("B"); await s.resume({ tools });
        const t3 = await s.turn("T3 after restart, no ctx", { tools, prompt: PROMPT });
        await s.closeProc(); await s.open("C"); await s.resume({ tools });
        const t4 = await s.turn("T4 after 2nd restart, no ctx", { tools, prompt: PROMPT });
        const id = L.DESIGN_ID_OF[state], q = [t1, t2, t3, t4].map((t) => normalReq(t).slice(-1)[0]);
        const r = await s.finish({ state, verdict: { immediate: fullLatest(q[0], id), noCtx: fullLatest(q[1], id), restart1: fullLatest(q[2], id), restart2: fullLatest(q[3], id), stateItemCounts: q.map((x) => x.inspect.devStateCount), compactionRequests: s.rec.requests.filter((x) => /compaction/.test(x.kind)).length } });
        out.push({ name: r.name, verdict: r.verdict });
      } catch (e) { out.push({ name: s.name, error: String(e.stack || e).slice(0, 300) }); try { await s.finish({}); } catch { /* */ } }
    }
    return out;
  }

  return { "live-restart": scenLiveRestart, "live-structural": scenLiveStructural, "live-behavior": scenLiveBehavior, "live-interrupt": scenLiveInterrupt };
};
