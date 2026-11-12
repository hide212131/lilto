/** Scenarios part 2 (long history, detection paths, interrupt-before-continuation). Loaded by app-server-compaction-probe.js. */
const fs = require("node:fs");
const path = require("node:path");
const L = require("./compaction-probe-lib.js");
const { now, findRollout } = L;

module.exports = (P) => {
  const { Session, TEXTS, compact, fullLatest, AUTO_LIMIT, BIG_USAGE } = P;
  const normalReq = (t) => t.requests.filter((r) => r.kind === "normal");
  const toolScript = (promptNeedle) => (rec) => {
    const input = rec.body?.input ?? []; const last = input[input.length - 1] ?? {};
    const lastText = Array.isArray(last.content) ? last.content.map((c) => c.text ?? "").join("") : "";
    if (last.role === "user" && lastText.includes(promptNeedle)) return { toolCall: { name: "exec_command", args: { cmd: "echo mid-turn-tool", yield_time_ms: 1000 } } };
    return null;
  };

  // ---------------------------------------------------------------- case 6: long history
  async function scenLong(outDir) {
    const s = await new Session("long", outDir, { autoCompact: true }).init(); await s.open("A");
    // legacy thread: the old unconditional prohibition lives in start's developerInstructions (first developer item)
    await s.start({ tools: 16, developerInstructions: TEXTS.OLD_ON });
    const refusal = "Sorry, I cannot do that: lilto prohibits external Chromium/Chrome, the agent-browser CLI and other Playwright browsers. REFUSAL-PROBE";
    const log = [];
    const mark = (t, expectId) => { const q = normalReq(t)[0]; if (!q) return; log.push({ label: t.label, expectId, requestIndex: q.seq, latest: q.inspect.latestDeveloperState, devStateCount: q.inspect.devStateCount, order: q.inspect.stateItems.map((i) => `${i.states.map((x) => x.id + (x.complete ? "" : "?")).join("+")}@${i.idx}:${i.role}`), oldOnDeveloperIdx: q.inspect.stateItems.filter((i) => i.role === "developer" && i.states.some((x) => x.id === "OLD_ON")).map((i) => i.idx), nonDev: q.inspect.nonDeveloperStateMentions, compactions: t.compactionItems.length / 2, hasRefusalInUserOrAssistant: JSON.stringify(s.rec.requests.find((r) => r.seq === q.seq).body.input).includes("REFUSAL-PROBE") }); };
    const big = () => { s.rec.state.usageTokens = BIG_USAGE; }, small = () => { s.rec.state.usageTokens = 1; };
    let t;
    t = await s.turn("T1 ON (legacy OLD_ON already in thread)", { state: "ON", tools: 16 }); mark(t, "D_ON");
    s.rec.state.script = (rec) => /refuse-now/.test(JSON.stringify(rec.body.input.slice(-1))) ? { text: refusal } : null;
    t = await s.turn("T2 refusal response (scripted)", { tools: 16, prompt: "refuse-now please" }); mark(t, "D_ON");
    s.rec.state.script = null;
    t = await s.turn("T3 OFF", { state: "OFF" }); mark(t, "D_OFF");
    big(); t = await s.turn("T4 (crosses limit)", {}); mark(t, "D_OFF"); small();
    t = await s.turn("T5 after compaction #1 (no resend)", {}); mark(t, "D_OFF");
    t = await s.turn("T6 ON_EVAL", { state: "ON_EVAL", tools: 17 }); mark(t, "D_ON_EVAL");
    t = await s.turn("T7 OFF", { state: "OFF" }); mark(t, "D_OFF");
    big(); t = await s.turn("T8 (crosses limit)", {}); mark(t, "D_OFF");
    t = await s.turn("T9 after compaction #2 (no resend; usage still big -> compaction #3)", {}); mark(t, "D_OFF"); small();
    t = await s.turn("T10 plain continue (no resend)", {}); mark(t, "D_OFF");
    // restart + continue without resend
    await s.closeProc(); await s.open("B"); await s.resume({});
    t = await s.turn("T11 after restart (no resend)", {}); mark(t, "D_OFF");
    // recovery path of section 7.3: resend the full latest state once after the compactions
    t = await s.turn("T12 resend OFF once (recovery)", { state: "OFF" }); mark(t, "D_OFF");
    t = await s.turn("T13 no resend", {}); mark(t, "D_OFF");
    const compactions = s.rec.requests.filter((r) => r.kind === "compaction").length;
    const afterCompactionNoResend = log.filter((l) => /^T(5|9|10|11)/.test(l.label));
    const verdict = {
      compactionRequests: compactions,
      latestPreservedAfterEachCompaction: afterCompactionNoResend.map((l) => ({ label: l.label, latest: l.latest?.id ?? null, ok: l.latest?.id === l.expectId && l.latest?.complete === true })),
      oldProhibitionReappearsAfterCompaction: afterCompactionNoResend.map((l) => ({ label: l.label, oldOnDeveloperIdx: l.oldOnDeveloperIdx })),
      recoveryResendOk: ["T12", "T13"].map((p) => log.find((l) => l.label.startsWith(p))).every((l) => l && l.latest?.id === l.expectId && l.latest.complete)
    };
    verdict.pass = verdict.latestPreservedAfterEachCompaction.every((x) => x.ok);
    return s.finish({ log, verdict, summary: s.turns.map(compact) });
  }

  // ---------------------------------------------------------------- detection paths (7.2)
  async function scenDetect(outDir) {
    const out = {};
    // explicit (manual) compaction + thread API view + restart generation
    {
      const s = await new Session("detect-explicit", outDir).init(); await s.open("A"); await s.start();
      await s.turn("T1", { state: "OFF" }); await s.turn("T2");
      const from = s.c.notes.length; await s.c.request("thread/compact/start", { threadId: s.threadId }); await s.c.waitNote((n) => n.method === "turn/completed", 60000, from); await new Promise((r) => setTimeout(r, 400));
      const notes = s.c.notes.slice(from).filter((n) => !/rateLimits|tokenUsage|agentMessage\/delta/.test(n.method));
      out.explicit = { notes: notes.map((n) => ({ t: +n.t.toFixed(1), method: n.method, itemType: n.params?.item?.type, itemKeys: n.params?.item ? Object.keys(n.params.item) : undefined, params: /contextCompaction|compact/i.test(JSON.stringify(n.params)) ? n.params : undefined })), compactionRequestT: s.rec.requests.filter((r) => r.kind === "compaction").map((r) => +r.t.toFixed(1)) };
      const read = await s.c.request("thread/read", { threadId: s.threadId, includeTurns: true }, 30000).catch((e) => ({ error: String(e.message) }));
      out.explicit.threadReadItemTypes = (read.thread?.turns ?? []).map((t) => ({ id: t.id, status: t.status, items: (t.items ?? []).map((i) => i.type) }));
      await s.closeProc(); await s.open("B");
      const res = await s.c.request("thread/resume", { threadId: s.threadId, ...s.base() }, 30000);
      out.explicit.resumeResponseTurnItemTypes = (res.thread?.turns ?? []).map((t) => (t.items ?? []).map((i) => i.type));
      const read2 = await s.c.request("thread/read", { threadId: s.threadId, includeTurns: true }, 30000).catch((e) => ({ error: String(e.message) }));
      out.explicit.threadReadAfterRestartItemTypes = (read2.thread?.turns ?? []).map((t) => ({ status: t.status, items: (t.items ?? []).map((i) => i.type) }));
      const r = await s.finish({}); out.explicit.rollout = r.rollout.compactionRecords.map((c) => ({ line: c.line, type: c.type, keys: c.keys, payload: c.payload, replacement: c.replacementHistory }));
      out.explicit.dir = "detect-explicit.*";
    }
    // auto, pre-turn (limit crossed by previous turn) -- already covered by 'compaction'; here record ordering precisely
    {
      const s = await new Session("detect-auto-preturn", outDir, { autoCompact: true }).init(); await s.open("A"); await s.start();
      await s.turn("T1", { state: "OFF" }); s.rec.state.usageTokens = BIG_USAGE; await s.turn("T2 crosses"); s.rec.state.usageTokens = 1;
      const t3 = await s.turn("T3 pre-turn auto compaction");
      out.autoPreTurn = ordering(s, t3);
      await s.finish({});
    }
    // auto, mid-turn (limit crossed inside a turn that needs a follow-up request after a tool call)
    {
      const s = await new Session("detect-auto-midturn", outDir, { autoCompact: true }).init(); await s.open("A"); await s.start({ tools: 16 });
      await s.turn("T1", { state: "ON", tools: 16 }); await s.turn("T2", { tools: 16 });
      s.rec.state.usageTokens = BIG_USAGE; s.rec.state.script = toolScript("midturn-tool");
      const t3 = await s.turn("T3 midturn", { tools: 16, prompt: "midturn-tool" }); s.rec.state.script = null; s.rec.state.usageTokens = 1;
      out.autoMidTurn = ordering(s, t3);
      const t4 = await s.turn("T4 next (no resend)", { tools: 16 });
      out.autoMidTurn.nextTurnLatest = normalReq(t4)[0]?.inspect.latestDeveloperState ?? null;
      out.autoMidTurn.postCompactionSameTurnRequestLatest = (normalReq(t3).slice(-1)[0] ?? {}).inspect?.latestDeveloperState ?? null;
      await s.finish({});
    }
    return out;
  }

  /** Ordering of notifications vs model requests inside one turn, relative to the compaction. */
  function ordering(s, t) {
    const tl = s.timeline.filter((e) => e.t >= t.requests[0]?.t - 50 || e.kind === "turn-begin");
    const begin = s.timeline.filter((e) => e.kind === "turn-begin" && e.label === t.label).pop();
    const ev = s.timeline.filter((e) => e.t >= begin.t && ((e.src === "model") || /^(turn\/started|turn\/completed)$/.test(e.method) || (/^item\/(started|completed)$/.test(e.method) && e.itemType === "contextCompaction") || /compact/i.test(e.method || ""))).map((e) => ({ t: +(e.t - begin.t).toFixed(2), what: e.src === "model" ? `model-request#${e.seq}:${e.kind}${e.inputItems ? "(" + e.inputItems + " items)" : ""}` : `${e.method}${e.itemType ? ":" + e.itemType : ""}` }));
    const iStart = ev.findIndex((e) => e.what === "item/started:contextCompaction");
    const iCompReq = ev.findIndex((e) => /model-request#\d+:compaction/.test(e.what));
    const iDone = ev.findIndex((e) => e.what === "item/completed:contextCompaction");
    const iNextNormal = ev.findIndex((e, i) => i > iCompReq && /model-request#\d+:normal/.test(e.what));
    return { events: ev, startedBeforeCompactionRequest: iStart >= 0 && iStart < iCompReq, completedBeforeNextNormalRequest: iDone >= 0 && iDone < iNextNormal, deltaStartedToCompactionRequestMs: ev[iCompReq] && ev[iStart] ? +(ev[iCompReq].t - ev[iStart].t).toFixed(2) : null, deltaCompletedToNextNormalRequestMs: ev[iNextNormal] && ev[iDone] ? +(ev[iNextNormal].t - ev[iDone].t).toFixed(2) : null };
  }

  // ---------------------------------------------------------------- interrupt-before-continuation (7.3/7.4)
  async function scenInterrupt(outDir) {
    const N = Number(process.env.PROBE_N || 5);
    const results = [];
    for (const variant of [{ id: "midturn-started-delay800", mid: true, on: "started", delay: 800 }, { id: "midturn-started-delay0", mid: true, on: "started", delay: 0 }, { id: "midturn-completed-delay0", mid: true, on: "completed", delay: 0 }, { id: "preturn-started-delay0", mid: false, on: "started", delay: 0 }]) {
      for (let i = 1; i <= N; i++) {
        const s = await new Session(`interrupt-${variant.id}-${i}`, outDir, { autoCompact: true }).init(); await s.open("A"); await s.start({ tools: 16 });
        await s.turn("T1", { state: "OFF", tools: 16 }); await s.turn("T2", { tools: 16 });
        s.rec.state.usageTokens = BIG_USAGE; s.rec.state.compactionDelayMs = variant.delay;
        if (variant.mid) s.rec.state.script = toolScript("midturn-tool"); else { await s.turn("T3 crosses", { tools: 16 }); }
        const want = variant.on === "started" ? "item/started" : "item/completed";
        const reqBefore = s.rec.requests.length;
        const t = await s.turn(variant.mid ? "T3 midturn" : "T4 preturn", { tools: 16, prompt: variant.mid ? "midturn-tool" : "ping", onNote: (n) => (n.method === want && n.params?.item?.type === "contextCompaction" ? { reason: `interrupt on ${want} contextCompaction` } : null), timeoutMs: 30000 });
        s.rec.state.script = null; s.rec.state.usageTokens = 1; s.rec.state.compactionDelayMs = 0;
        const reqs = s.rec.requests.slice(reqBefore);
        const compIdx = reqs.findIndex((r) => r.kind === "compaction");
        const normalAfterCompaction = reqs.slice(compIdx + 1).filter((r) => r.kind === "normal");
        // next turn: resend OFF once (7.3 recovery) and check the latest state is in the input
        const nxt = await s.turn("T-next resend OFF", { state: "OFF", tools: 16 });
        const nq = normalReq(nxt)[0];
        const r = { variant: variant.id, i, turnStatus: t.status, interruptRequestedAtMsSinceTurnBegin: t.interrupted ? +(t.interrupted.at - (s.timeline.filter((e) => e.kind === "turn-begin" && e.label === t.label).pop().t)).toFixed(2) : null, interruptRpcOk: !!t.interrupted?.rpcDone && !t.interrupted?.err, interruptErr: t.interrupted?.err, compactionRequestsInTurn: reqs.filter((q) => q.kind === "compaction").length, normalRequestsAfterCompactionInSameTurn: normalAfterCompaction.length, stoppedBeforeContinuation: t.status === "interrupted" && normalAfterCompaction.length === 0, nextTurnLatest: nq?.inspect.latestDeveloperState ?? null, nextTurnRecovered: !!nq && fullLatest(nq, "D_OFF"), nextTurnStatus: nxt.status };
        results.push(r);
        await s.finish({ r });
      }
    }
    const summary = {};
    for (const r of results) { const k = r.variant; summary[k] ??= { n: 0, stoppedBeforeContinuation: 0, interruptedStatus: 0, normalAfterCompaction: 0, recoveredNext: 0 }; const x = summary[k]; x.n++; x.stoppedBeforeContinuation += r.stoppedBeforeContinuation ? 1 : 0; x.interruptedStatus += r.turnStatus === "interrupted" ? 1 : 0; x.normalAfterCompaction += r.normalRequestsAfterCompactionInSameTurn; x.recoveredNext += r.nextTurnRecovered ? 1 : 0; }
    fs.writeFileSync(path.join(outDir, "interrupt-results.json"), JSON.stringify({ summary, results }, null, 1));
    return { summary, results };
  }

  return { long: scenLong, detect: scenDetect, interrupt: scenInterrupt };
};
