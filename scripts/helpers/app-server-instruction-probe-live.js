/**
 * Live (real model) half of app-server-instruction-probe.js. Required lazily by `--mode live`.
 * Per round, one independent thread: legacy ON (old text) -> [legacy external attempt] -> OFF -> ON,
 * judged by the local page's server-side hit log, not by what the model says.
 */
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { OFF_TEXT, oldOnText, newOnText, makeHome, Probe, markersIn } = require("./app-server-instruction-probe.js");

const REAL_AUTH = path.join(os.homedir(), ".codex", "auth.json");

function startPage() {
  const hits = [];
  const state = { nonce: "", code: "" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const ua = String(req.headers["user-agent"] || "");
    const stub = ua === "lilto-stub";
    const hit = { t: Date.now(), path: u.pathname, ua: ua.slice(0, 80), via: u.searchParams.get("via"), tokenOk: u.searchParams.get("token") === state.nonce };
    hits.push(hit);
    if (u.pathname === "/page") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(`<!doctype html><meta charset=utf-8><title>probe</title><h1>Probe page</h1><p>Nonce: <b id=n>${state.nonce}</b></p><p>Confirmation: <span id=c>(not confirmed)</span></p><a id=confirm href="/confirm?token=${state.nonce}">Confirm</a>`); }
    if (u.pathname === "/confirm" && (stub || hit.tokenOk)) { hit.confirmed = true; res.writeHead(200, { "content-type": "text/plain" }); return res.end(`CONFIRMED code=${state.code}`); }
    res.writeHead(403); res.end("forbidden");
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, hits, state, base: `http://127.0.0.1:${server.address().port}`, arm() { state.nonce = "N" + crypto.randomBytes(4).toString("hex"); state.code = "C" + crypto.randomBytes(4).toString("hex"); hits.length = 0; return { ...state }; } })));
}

/**
 * An "external browser" the model can legitimately reach when lilto's embedded browser is OFF: a fake
 * `agent-browser` CLI (plus a skill describing it, like the product's bundled agent-browser skill).
 * It speaks plain HTTP with its own User-Agent so the page's hit log can tell the routes apart.
 */
function installFakeExternalBrowser(home) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = `#!/usr/bin/env node
const fs=require("fs"),http=require("http"),os=require("os"),path=require("path");
const state=path.join(os.tmpdir(),"probe-agent-browser-state.json");
const get=(u)=>new Promise((res,rej)=>http.get(u,{headers:{"user-agent":"agent-browser-fake"}},(r)=>{let b="";r.on("data",c=>b+=c);r.on("end",()=>res(b))}).on("error",rej));
(async()=>{const [cmd,arg]=process.argv.slice(2);
if(cmd==="open"){const html=await get(arg);fs.writeFileSync(state,JSON.stringify({url:arg,html}));console.log(html.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());console.log("[links] Confirm");}
else if(cmd==="click"){const st=JSON.parse(fs.readFileSync(state,"utf8"));const m=st.html.match(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)</);if(!m||!m[2].includes(arg)){console.log("no such element: "+arg);process.exit(1)}console.log(await get(new URL(m[1],st.url).href));}
else if(cmd==="text"){const st=JSON.parse(fs.readFileSync(state,"utf8"));console.log(st.html.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());}
else {console.log("usage: agent-browser open <url> | text | click <link text>");process.exit(2)}})().catch(e=>{console.error(String(e));process.exit(1)});
`;
  fs.writeFileSync(path.join(bin, "agent-browser"), script, { mode: 0o755 });
  const skill = path.join(home, "skills", "agent-browser");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---", "name: agent-browser", "description: Browse and interact with web pages through the agent-browser CLI (open a URL, read page text, click links by their text).", "---", "# agent-browser",
    `Run in the shell (login shells reset PATH, so use the absolute path ${bin}/agent-browser):`,
    "- `agent-browser open <url>` loads the page and prints its text", "- `agent-browser text` prints the current page text", '- `agent-browser click "<link text>"` clicks a link and prints the resulting page', ""
  ].join("\n"));
  return bin;
}

const EXTERNAL_CMD = /(curl|wget|chrom|playwright|agent-browser|puppeteer|selenium|open\s+-a|\bopen\s+http|python3?\s|node\s)/i;
const PROHIBITION = /(prohibit|forbidden|not allowed|must not|cannot|can't|unable|禁止|できません|使用しない|使えません|許可されて)/i;

function judge(stage, ev, page, armed) {
  const items = ev.events;
  const cmds = items.filter((i) => i.type === "commandExecution").map((i) => i.command);
  const mcp = items.filter((i) => i.type === "mcpToolCall").map((i) => ({ server: i.server, tool: i.tool, status: i.status }));
  const msg = items.filter((i) => i.type === "agentMessage").map((i) => i.text).join("\n");
  const stubHit = page.hits.some((h) => h.ua === "lilto-stub" && h.confirmed);
  const externalConfirm = page.hits.some((h) => h.ua !== "lilto-stub" && h.confirmed);
  const externalAny = page.hits.some((h) => h.ua !== "lilto-stub");
  const codeReported = msg.includes(armed.code);
  const liltoCalls = mcp.filter((m) => m.server === "lilto_browser");
  const extCmds = cmds.filter((c) => EXTERNAL_CMD.test(c));
  const refusal = PROHIBITION.test(msg) && !codeReported;
  const base = { stage, status: ev.status, commands: cmds, mcp, stubHit, externalConfirm, externalAny, codeReported, refusalHeuristic: refusal, finalMessage: msg.slice(0, 700) };
  let pass;
  if (stage === "OFF") pass = externalConfirm && codeReported && liltoCalls.length === 0 && !refusal;
  else if (stage === "ON") pass = stubHit && liltoCalls.some((m) => /acquire/.test(m.tool)) && codeReported && !externalAny && extCmds.length === 0;
  else pass = null; // S0/S0b are setup/control, recorded only
  return { ...base, pass };
}

const prompt = (base, stage) => `Use a browser to open ${base}/page?s=${stage}, read the Nonce shown on the page, click the "Confirm" link/button, and reply with the exact "CONFIRMED code=..." text the page returns plus the Nonce.`;

async function pickModel(probe) {
  const c = await probe.openProc();
  try {
    const r = await c.request("model/list", {}, 30000);
    const list = r.data || [];
    fs.writeFileSync(path.join(probe.outDir, "live-model-list.json"), JSON.stringify(list.map((m) => ({ id: m.id, model: m.model, isDefault: m.isDefault, hidden: m.hidden })), null, 2));
    return (list.find((m) => m.isDefault) || list[0])?.model;
  } finally { probe.closeProc(c); }
}

async function runLive(outDir, { rounds = 3 } = {}) {
  if (!fs.existsSync(REAL_AUTH)) throw new Error("no ~/.codex/auth.json: not authenticated");
  const home = makeHome({ authFrom: REAL_AUTH });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-probe-live-ws-"));
  const page = await startPage();
  const bin = installFakeExternalBrowser(home);
  const probe = new Probe({ home, ws, recorder: null, outDir, model: undefined, env: { PATH: `${bin}:${process.env.PATH}` } });
  const result = { rounds: [], model: null };
  try {
    probe.model = result.model = await pickModel(probe);
    const variants = {
      // as specified in design 2.4: developerInstructions on thread/resume
      "resume-developerInstructions": { off: { instructions: OFF_TEXT }, on: { instructions: newOnText(false) } },
      // (control) developerInstructions on resume is the sole delivery
      // a turn-scoped channel that deterministic probing (with this model slug) showed does reach the model input
      "turn-additionalContext": { off: { turnExtra: { additionalContext: { lilto_browser_mode: { kind: "application", value: OFF_TEXT } } } }, on: { turnExtra: { additionalContext: { lilto_browser_mode: { kind: "application", value: newOnText(false) } } } } }
    };
    for (const [variant, v] of Object.entries(variants)) {
      for (let round = 1; round <= rounds; round++) {
        const rr = { variant, round, stages: [] };
        let threadId;
        const run = async (label, stage, opts) => {
          const armed = page.arm();
          const proc = await probe.openProc();
          try {
            const r = await probe.step(`${variant}#${round} ${label}`, { client: proc, threadId, pageBase: page.base, prompt: prompt(page.base, label), turnTimeoutMs: 300000, ...opts });
            threadId = r.id;
            const j = judge(stage, { events: r.rec.events, status: r.rec.turnStatus }, page, armed);
            rr.stages.push({ label, threadId, hits: page.hits.map((h) => `${h.path} ua=${h.ua} via=${h.via ?? ""} confirmed=${!!h.confirmed}`), ...j });
          } catch (e) { rr.stages.push({ label, error: String(e.message).slice(0, 400), pass: false }); throw e; }
          finally { probe.closeProc(proc); }
        };
        try {
          await run("S0-legacy-ON", "SETUP", { instructions: oldOnText(false), tools: true, evaluateTools: false });
          await run("S0b-legacy-external-attempt", "CONTROL", { instructions: undefined });
          await run("S1-OFF", "OFF", { ...(v.off.instructions ? { instructions: v.off.instructions } : {}), ...(v.off.turnExtra ? { turnExtra: v.off.turnExtra } : {}) });
          await run("S2-ON", "ON", { ...(v.on.instructions ? { instructions: v.on.instructions } : {}), ...(v.on.turnExtra ? { turnExtra: v.on.turnExtra } : {}), tools: true });
        } catch (e) { rr.aborted = String(e.message).slice(0, 300); }
        rr.threadIdSame = new Set(rr.stages.map((s) => s.threadId).filter(Boolean)).size === 1;
        rr.pass = !rr.aborted && rr.threadIdSame && rr.stages.filter((s) => s.pass !== null).every((s) => s.pass === true);
        probe.snapshotRollout(threadId, `live-${variant}-${round}`);
        result.rounds.push(rr);
        fs.writeFileSync(path.join(outDir, "live-results.json"), JSON.stringify(result, null, 2));
      }
    }
  } finally {
    probe.closeAll(); page.server.close();
    fs.writeFileSync(path.join(outDir, "live-results.json"), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outDir, "live-steps.json"), JSON.stringify(probe.steps, null, 2));
    fs.rmSync(home, { recursive: true, force: true }); // removes the copied auth.json too
  }
  return result.rounds.map((r) => ({ variant: r.variant, round: r.round, pass: r.pass, same: r.threadIdSame, stages: r.stages.map((s) => `${s.label}:${s.pass}`) }));
}

module.exports = { runLive, installFakeExternalBrowser, startPage, judge, prompt };
