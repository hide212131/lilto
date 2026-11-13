/**
 * Live UI verification of the browser-instruction lifecycle in the REAL Electron app (issue #43, task 10).
 * Playwright drives the actual window: select a legacy conversation (created like v0.1.17 did: ON instructions in
 * thread/start + a refusal), switch the browser settings in the settings modal, and keep talking in the SAME
 * conversation. A local recording Responses server (no model, no auth) shows what the model really received; the
 * state file in the isolated userData shows what lilto persisted. Includes an app restart.
 *
 *   npm run build && node scripts/verify-instruction-lifecycle-ui.js [--out DIR]
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { startRecorder } = require("./helpers/compaction-probe-lib.js");
const { removeDirs, stateItems, BIN, AUTO_LIMIT, BIG_USAGE } = require("./helpers/instruction-lifecycle-lab.js");
const { oldOnText } = require("./helpers/app-server-instruction-probe.js");
const { CodexAppServerClient } = require(path.join(root, "dist/main/codex-app-server-client.js"));
const { resolveBrowserInstructionUpdate } = require(path.join(root, "dist/main/agent-sdk-config.js"));
const { connectToElectronApp, waitForAppReady, resolveNamedLocator } = require("./electron-playwright.js");

const outIndex = process.argv.indexOf("--out");
const outDir = path.resolve(outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, "test", "artifacts", "instruction-lifecycle-ui"));
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`); };
const text = {
  off: resolveBrowserInstructionUpdate({ enabled: false, evaluateEnabled: false }).text,
  on: resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: false }).text,
  onEval: resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled: true }).text
};

let currentStep = "start";
const step = (name) => { currentStep = name; console.log(`  .. ${name}`); };
if (process.env.UI_DEBUG) setInterval(() => console.log(`  [watchdog] ${new Date().toISOString()} step=${currentStep}`), 20000).unref();
const withTimeout = (promise, ms, name) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${name}`)), ms))]);
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on("error", reject); });
const electronBin = process.platform === "win32" ? path.join(root, "node_modules/electron/dist/electron.exe")
  : process.platform === "darwin" ? path.join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron") : path.join(root, "node_modules/electron/dist/electron");

async function main() {
  const timeline = [];
  const recorder = await startRecorder(timeline);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-ui-"));
  const codexHome = path.join(userData, "codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), ['model = "probe-model"', 'model_provider = "probe"', "", "[model_providers.probe]", 'name = "probe"', `base_url = "http://127.0.0.1:${recorder.port}/v1"`, 'wire_api = "responses"', "supports_websockets = false", "requires_openai_auth = false"].join("\n") + "\n");
  const settingsFile = path.join(userData, "provider-settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ activeProvider: "custom-openai-completions", customProvider: { name: "probe", baseUrl: `http://127.0.0.1:${recorder.port}/v1`, apiKey: "k", modelId: "probe-model" }, browserSettings: { enabled: true, autoOpenOnToolUse: false, evaluateEnabled: false } }));

  // Legacy conversation as v0.1.17 left it.
  const seed = new CodexAppServerClient({ codexHomeDir: codexHome, codexCommand: BIN, invocationEnv: {} });
  await seed.start();
  const started = await seed.request("thread/start", { cwd: root, approvalPolicy: "never", sandbox: "danger-full-access", serviceName: "lilto", model: "probe-model", developerInstructions: oldOnText(false) });
  const threadId = started.thread.id;
  recorder.state.script = () => ({ text: "Sorry, I cannot do that: lilto prohibits external Chromium/Chrome. REFUSAL-LEGACY" });
  await seed.request("turn/start", { threadId, input: [{ type: "text", text: "legacy question: please open a browser", text_elements: [] }], cwd: root, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, model: "probe-model" });
  for (;;) { const n = await seed.nextNotification({ timeoutMs: 60000 }); if (n.method === "turn/completed") break; }
  recorder.state.script = null;
  seed.close();

  let child = null;
  const env = { ...process.env, CODEX_HOME: codexHome, LILTO_PROVIDER_SETTINGS_PATH: settingsFile, HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: "", https_proxy: "", NO_PROXY: "", no_proxy: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  let browser, page;
  const launch = async () => {
    const port = await freePort();
    child = spawn(electronBin, [".", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: root, env, stdio: process.env.UI_DEBUG ? "inherit" : "ignore" });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
    ({ browser, page } = await connectToElectronApp(port));
    await waitForAppReady(page);
    page.setDefaultTimeout(20000);
  };
  const quit = async () => { try { await browser?.close(); } catch { /* */ } if (child) { child.kill(); await new Promise((r) => child.once("exit", r)); child = null; } };

  const app = () => resolveNamedLocator(page, "app");
  const normalRequests = () => recorder.requests.filter((r) => r.kind === "normal");
  const selectLegacyConversation = async () => {
    await app().locator("lilt-top-bar").locator("button").first().click();
    await app().locator("lilt-chat-history").locator(`[data-session-id="${threadId}"]`).click();
    await page.waitForFunction(() => document.querySelector("lilt-app")?.shadowRoot?.querySelector("lilt-message-list")?.shadowRoot?.textContent?.includes("legacy question") ?? false, null, { timeout: 15000 }).catch(() => {});
  };
  const setBrowser = async ({ enabled, evaluate }) => {
    step(`settings enabled=${enabled} evaluate=${evaluate}`);
    await resolveNamedLocator(page, "settingsButton").click();
    await resolveNamedLocator(page, "settingsModal").waitFor({ state: "visible", timeout: 5000 });
    await app().locator("lilt-settings-modal").locator(".settings-menu-item", { hasText: "ブラウザ" }).click();
    const box = (id) => app().locator("lilt-settings-modal").locator(`#${id}`);
    if ((await box("browser-enabled").isChecked()) !== enabled) await box("browser-enabled").click();
    if (enabled && (await box("browser-evaluate").isChecked()) !== evaluate) await box("browser-evaluate").click();
    await box("browser-save").click();
    await app().locator("lilt-settings-modal").locator('.status[role="status"]', { hasText: "保存しました" }).waitFor({ timeout: 30000 });
    await resolveNamedLocator(page, "settingsClose").click();
    await resolveNamedLocator(page, "settingsModal").waitFor({ state: "hidden", timeout: 5000 });
  };
  let turnNo = 0;
  const say = async (label) => {
    const before = normalRequests().length;
    const marker = `ui-turn-${++turnNo}-${label}`;
    step(`send ${marker}`);
    const input = resolveNamedLocator(page, "composerInput");
    currentStep = "fill"; await input.fill(marker);
    currentStep = "click send"; await resolveNamedLocator(page, "composerSend").click();
    currentStep = "wait request";
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && normalRequests().length <= before) await new Promise((r) => setTimeout(r, 200));
    // The model answered; wait until the app is idle again (status "待機中") so the turn's confirm/save has run.
    const idleBy = Date.now() + 30000;
    while (Date.now() < idleBy) {
      const status = (await withTimeout(resolveNamedLocator(page, "status").textContent(), 3000, "status").catch(() => "")) ?? "";
      if (status.includes("待機中")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (normalRequests().length <= before) {
      const { collectMessages } = require("./electron-playwright.js");
      console.log("  !! no model request; last messages:", JSON.stringify((await withTimeout(collectMessages(page), 5000, "messages").catch(() => [])).slice(-3)).slice(0, 600));
    }
    await new Promise((r) => setTimeout(r, 1500)); // settle: confirm save + UI completion
    const reqs = normalRequests().slice(before);
    const last = reqs.at(-1);
    return { marker, requests: reqs.length, items: last ? stateItems(last.body) : [], body: last?.body };
  };
  const stateFile = () => JSON.parse(fs.readFileSync(path.join(userData, "browser-instruction-state.json"), "utf8"));
  const records = () => Object.values(Object.values(stateFile().namespaces)[0] ?? {});

  try {
    await launch();
    await selectLegacyConversation();
    await page.screenshot({ path: path.join(outDir, "01-legacy-conversation.png") });

    await setBrowser({ enabled: false, evaluate: false });
    let t = await say("off-recovery");
    check("OFF: first turn in the legacy conversation carries exactly one OFF state item", t.items.length === 1 && t.items[0].text.includes(text.off), t.items.length);
    check("OFF: the legacy ON text and the refusal are still in history (conversation was continued, not recreated)", JSON.stringify(t.body.input).includes("REFUSAL-LEGACY") && JSON.stringify(t.body.input).includes("Do not start an external Chromium/Chrome"));
    check("OFF: no lilto_browser tool offered", !JSON.stringify(t.body.tools ?? []).includes("lilto_browser"));
    t = await say("off-again");
    check("OFF unchanged: no new state item", t.items.length === 1, t.items.length);
    await page.screenshot({ path: path.join(outDir, "02-off-continued.png") });

    await setBrowser({ enabled: true, evaluate: false });
    t = await say("on");
    check("ON: one more state item (2), latest is the ON text with evaluate OFF", t.items.length === 2 && t.items[1].text.includes(text.on), t.items.map((i) => i.text.slice(0, 80)));
    check("ON: lilto_browser tools are offered", JSON.stringify(t.body.tools ?? []).includes("lilto_browser") || JSON.stringify(t.body).includes("lilto_browser"));
    t = await say("on-again");
    check("ON unchanged: still 2", t.items.length === 2, t.items.length);

    await setBrowser({ enabled: true, evaluate: true });
    t = await say("evaluate-on");
    check("evaluate ON: one more state item (3) with the evaluate rules", t.items.length === 3 && t.items[2].text.includes(text.onEval), t.items.length);

    await setBrowser({ enabled: false, evaluate: false });
    t = await say("off-again2");
    check("OFF again: one more state item (4)", t.items.length === 4 && t.items[3].text.includes(text.off), t.items.length);
    await page.screenshot({ path: path.join(outDir, "03-off-again.png") });

    const sessionItems = await app().locator("lilt-chat-history").locator(".session-item").count();
    check("the same single conversation throughout (no new thread was created)", sessionItems === 1 && normalRequests().every((r) => true), sessionItems);
    const recs = records();
    check("state file: one thread, confirmed OFF", recs.length === 1 && recs[0].status === "confirmed" && recs[0].confirmedState.browser === "off", recs);
    check("state file holds no conversation text or secrets", !/ui-turn|REFUSAL|token|lilto_browser/i.test(fs.readFileSync(path.join(userData, "browser-instruction-state.json"), "utf8")));

    await quit();
    await launch(); // app restart (compaction-free): confirmed state must be restored
    await selectLegacyConversation();
    t = await say("after-restart");
    check("after app restart: OFF continues with NO new state item (still 4)", t.items.length === 4, t.items.length);
    await page.screenshot({ path: path.join(outDir, "04-after-restart.png") });

    // ---- what the user sees when a turn is stopped at a compaction, and how they continue
    const { collectMessages } = require("./electron-playwright.js");
    fs.appendFileSync(path.join(codexHome, "config.toml"), "");
    const cfg = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    fs.writeFileSync(path.join(codexHome, "config.toml"), `model_auto_compact_token_limit = ${AUTO_LIMIT}\n${cfg}`);
    recorder.state.usageTokens = BIG_USAGE;
    t = await say("crossing-the-limit"); // this response reports big usage; the NEXT turn compacts before it starts
    check("compaction setup: the limit-crossing turn itself runs normally", t.items.length === 4, t.items.length);
    recorder.state.usageTokens = 1;
    const reqBefore = recorder.requests.length;
    const stopMarker = `ui-turn-${++turnNo}-stopped-by-compaction`;
    step(`send ${stopMarker}`);
    await resolveNamedLocator(page, "composerInput").fill(stopMarker);
    await resolveNamedLocator(page, "composerSend").click();
    const stopDeadline = Date.now() + 40000;
    let messages = [];
    while (Date.now() < stopDeadline) {
      messages = await withTimeout(collectMessages(page), 5000, "messages").catch(() => []);
      if (messages.some((m) => m.includes("自動圧縮"))) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    await page.screenshot({ path: path.join(outDir, "05-stopped-by-compaction.png") });
    const afterStop = recorder.requests.slice(reqBefore);
    const compIndex = afterStop.findIndex((r) => r.kind === "compaction");
    check("compaction: the turn was stopped and the app shows the retry message", messages.some((m) => m.includes("自動圧縮") && m.includes("続けて")), messages.slice(-2));
    check("compaction: no normal model request followed the compaction in the stopped turn", compIndex >= 0 ? afterStop.slice(compIndex + 1).every((r) => r.kind !== "normal") : afterStop.every((r) => r.kind !== "normal"), afterStop.map((r) => r.kind));
    const draft = await resolveNamedLocator(page, "composerInput").inputValue();
    check("compaction: the user's text is restored to the composer", draft === stopMarker, draft);
    check("compaction: thread record is unknown (state will be re-sent)", records()[0]?.status === "unknown", records());
    await resolveNamedLocator(page, "composerSend").click(); // the user just sends it again
    const retryDeadline = Date.now() + 60000;
    while (Date.now() < retryDeadline && !normalRequests().slice(-1).some((r) => r.seq > (afterStop.at(-1)?.seq ?? 0) && stateItems(r.body).length >= 1)) await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => setTimeout(r, 2000));
    const retried = normalRequests().at(-1);
    const retriedItems = retried ? stateItems(retried.body) : [];
    check("compaction: re-sending continues the same conversation and the OFF state is in the model input after the compaction", retriedItems.length >= 1 && retriedItems.at(-1).text.includes(text.off), retriedItems.length);
    await page.screenshot({ path: path.join(outDir, "06-continued-after-compaction.png") });
  } catch (error) {
    check("ui verification threw", false, String(error?.stack ?? error));
    try { await withTimeout(page?.screenshot({ path: path.join(outDir, "error.png") }), 10000, "screenshot"); } catch { /* */ }
  } finally {
    await quit();
    recorder.close();
    await removeDirs([userData]);
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ total: results.length, failed: failed.length, results, threadId }, null, 1));
  console.log(`${results.length - failed.length}/${results.length} UI checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
