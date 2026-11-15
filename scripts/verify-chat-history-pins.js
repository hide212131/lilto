/**
 * Real-DOM regression check for Issue #48 (サイドパネルでスレッドのピン留め).
 *
 * Follows the `scripts/verify-chat-history-unread-dot.js` precedent: bundles the real
 * src/renderer/components/chat-history.ts with esbuild and renders it in an actual Electron
 * BrowserWindow (no reimplementation of the component's pin logic). Unlike that script, several
 * of this feature's acceptance checks are about real CSS (:hover, :focus-within) and real
 * keyboard interaction (Tab, Enter, Space) per the design doc (thread-pin-design.md section 7.2):
 * synthetic `dispatchEvent`/`.click()` calls cannot exercise `:hover`, so this script also opens a
 * CDP connection with `playwright-core` (the same dependency `scripts/electron-playwright.js`
 * already uses) and drives the harness window with real mouse/keyboard input.
 *
 *   electron scripts/verify-chat-history-pins.js
 */
const { app, BrowserWindow } = require("electron");
const esbuild = require("esbuild");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const CDP_PORT = 9346;

const results = [];
const check = (name, condition, detail) => {
  results.push({ name, ok: Boolean(condition), ...(condition ? {} : { detail: String(detail ?? "") }) });
  if (!condition) console.error(`FAIL ${name} ${detail ?? ""}`);
};

function bundleChatHistory() {
  const built = esbuild.buildSync({
    entryPoints: [path.join(root, "src/renderer/components/chat-history.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    // Matches vite.config.ts's esbuild.tsconfigRaw so decorator semantics are identical to the real build.
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false }
    }
  });
  return built.outputFiles[0].text;
}

function writeHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-chat-history-pins-dom-"));
  fs.writeFileSync(path.join(dir, "chat-history.bundle.js"), bundleChatHistory());
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><body><script type="module" src="./chat-history.bundle.js"></script></body></html>`
  );
  return dir;
}

function makeSession(id, overrides = {}) {
  return { id, title: id, createdAt: 1, updatedAt: 1, hasUnread: false, isPinned: false, messages: [], ...overrides };
}

async function connectHarnessPage(timeoutMs = 15000) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().startsWith("file://") && page.url().endsWith("index.html")) {
          return { browser, page };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await browser.close().catch(() => {});
  throw new Error("Timed out waiting for the chat-history harness page over CDP");
}

/** Mounts a fresh <lilt-chat-history> with the given properties and returns nothing (element stays attached as #subject). */
async function mount(page, props) {
  await page.evaluate((p) => {
    const old = document.getElementById("subject");
    if (old) old.remove();
    window.__events = [];
    const el = document.createElement("lilt-chat-history");
    el.id = "subject";
    for (const [key, value] of Object.entries(p)) el[key] = value;
    for (const type of ["select-session", "set-session-pinned", "rename-session", "archive-session", "delete-session"]) {
      el.addEventListener(type, (e) => window.__events.push({ type, detail: e.detail, bubbles: e.bubbles, composed: e.composed }));
    }
    document.body.appendChild(el);
    return el.updateComplete;
  }, props);
}

async function subjectEval(page, fn, arg) {
  return page.evaluate(([fnSrc, a]) => {
    const el = document.getElementById("subject");
    // eslint-disable-next-line no-new-func
    const f = new Function("el", "arg", `return (${fnSrc})(el, arg)`);
    return f(el, a);
  }, [fn.toString(), arg]);
}

async function runStructuralChecks(page) {
  // D1: pinned group placement, order, uniqueness; cron pin leaves scheduled and returns on unpin.
  await mount(page, {
    sessions: [
      makeSession("A", { isPinned: true, updatedAt: 1, createdAt: 1 }),
      makeSession("B", { isPinned: true, updatedAt: 5, createdAt: 1 }),
      makeSession("C", { updatedAt: 10, createdAt: 1 })
    ],
    schedules: []
  });
  const order = await subjectEval(page, (el) =>
    [...el.shadowRoot.querySelectorAll("#pinned ~ [data-session-id], section[aria-labelledby='pinned'] [data-session-id]")].map((n) => n.dataset.sessionId));
  check("D1 list: pinned group exists with B before A (updatedAt desc)", order[0] === "B" && order[1] === "A", order.join(","));
  const pinnedHeaderCount = await subjectEval(page, (el) => el.shadowRoot.querySelectorAll("#pinned").length);
  check("D1 list: exactly one pinned header, no duplicate rendering", pinnedHeaderCount === 1, pinnedHeaderCount);
  const totalRows = await subjectEval(page, (el) => el.shadowRoot.querySelectorAll("[data-session-id]").length);
  check("D1 list: each session renders exactly once (3 rows for 3 sessions)", totalRows === 3, totalRows);

  await mount(page, { sessions: [], schedules: [] });
  const noPinnedHeader = await subjectEval(page, (el) => el.shadowRoot.querySelectorAll("#pinned").length === 0);
  check("D1: zero pins shows no pinned header or empty text", noPinnedHeader, "header present with 0 pins");

  // Pinned cron session leaves the scheduled category; unpin returns it there.
  await mount(page, { sessions: [makeSession("CRON", { isPinned: true, updatedAt: 1, createdAt: 1 })], schedules: [{ id: "s", kind: "cron", sessionId: "CRON" }] });
  const cronInScheduledWhilePinned = await subjectEval(page, (el) => Boolean(el.shadowRoot.querySelector("#scheduled ~ [data-session-id='CRON'], section[aria-labelledby='scheduled'] [data-session-id='CRON']")));
  check("D1: a pinned cron session is removed from 定期タスク while pinned", !cronInScheduledWhilePinned, "still listed under scheduled");
  await subjectEval(page, (el) => { el.sessions = [{ ...el.sessions[0], isPinned: false }]; return el.updateComplete; });
  const cronBackInScheduled = await subjectEval(page, (el) => Boolean(el.shadowRoot.querySelector("section[aria-labelledby='scheduled'] [data-session-id='CRON']")));
  check("D1: unpinning a cron session returns it to 定期タスク", cronBackInScheduled, "not back under scheduled");

  // Activity mode: pinned group + flat remainder, no extra header for the remainder.
  await mount(page, {
    activityMode: true,
    sessions: [makeSession("A", { isPinned: true, updatedAt: 1, createdAt: 1 }), makeSession("B", { updatedAt: 5, createdAt: 1 })]
  });
  const activityPinnedOk = await subjectEval(page, (el) => Boolean(el.shadowRoot.querySelector("section[aria-labelledby='pinned'] .activity-item[data-session-id='A']")));
  check("D1 activity: pinned session renders inside the pinned section via _renderActivityItem", activityPinnedOk, "not found");
  const extraHeaders = await subjectEval(page, (el) => el.shadowRoot.querySelectorAll(".category-title").length);
  check("D1 activity: no extra heading besides ピン留め for the remainder", extraHeaders === 1, extraHeaders);

  // D2: search excludes non-matching pinned sessions; matching pinned sessions still show in the pinned group.
  await mount(page, {
    sessions: [
      makeSession("match-pinned", { isPinned: true, title: "hello world", updatedAt: 1, createdAt: 1 }),
      makeSession("nomatch-pinned", { isPinned: true, title: "unrelated", updatedAt: 2, createdAt: 1 }),
      makeSession("match-plain", { title: "hello there", updatedAt: 3, createdAt: 1 })
    ],
    schedules: []
  });
  await subjectEval(page, (el) => {
    const input = el.shadowRoot.querySelector("input[type=search]");
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return el.updateComplete;
  });
  const searchedIds = await subjectEval(page, (el) => [...el.shadowRoot.querySelectorAll("[data-session-id]")].map((n) => n.dataset.sessionId));
  check("D2: unmatched pinned session is excluded from search results",
    searchedIds.includes("match-pinned") && !searchedIds.includes("nomatch-pinned") && searchedIds.includes("match-plain"),
    searchedIds.join(","));
  // The 200ms search debounce resolves to _searching=false once the (here: empty, no backendSessionId) content-fetch queue drains.
  await page.waitForTimeout(300);
  const statusText = await subjectEval(page, (el) => el.shadowRoot.querySelector(".search-status").textContent.trim());
  check("D2: result count reflects only matched sessions (2)", statusText.startsWith("2件"), statusText);

  // D5: Heartbeat, editing and busy/pending states never render (or disable) the pin button.
  await mount(page, { sessions: [makeSession("heartbeat-assistant", { isPinned: false })] });
  const heartbeatHasPinButton = await subjectEval(page, (el) => Boolean(el.shadowRoot.querySelector("[data-session-id='heartbeat-assistant'] .pin-btn")));
  check("D5: Heartbeat (fixed ID) has no pin button", !heartbeatHasPinButton, "pin button present for Heartbeat");
  await mount(page, { sessions: [makeSession("heartbeat-assistant:2026-11-15", { isPinned: false })] });
  const heartbeatDatedHasPinButton = await subjectEval(page, (el) => Boolean(el.shadowRoot.querySelector("[data-session-id] .pin-btn")));
  check("D5: Heartbeat (dated ID) has no pin button", !heartbeatDatedHasPinButton, "pin button present for dated Heartbeat");

  await mount(page, { sessions: [makeSession("busy", {})], busySessionIds: ["busy"] });
  const busyDisabled = await subjectEval(page, (el) => el.shadowRoot.querySelector("[data-session-id='busy'] .pin-btn").disabled);
  check("D5: archive/delete-busy session's pin button is disabled", busyDisabled, "not disabled");

  await mount(page, { sessions: [makeSession("pend", {})], pinningSessionIds: ["pend"] });
  const pendingDisabled = await subjectEval(page, (el) => el.shadowRoot.querySelector("[data-session-id='pend'] .pin-btn").disabled);
  check("D5: pin-pending session's pin button is disabled", pendingDisabled, "not disabled");

  await mount(page, { sessions: [makeSession("running", {})], runningSessionIds: ["running"] });
  const runningEnabled = await subjectEval(page, (el) => !el.shadowRoot.querySelector("[data-session-id='running'] .pin-btn").disabled);
  check("D5: a running (but not busy/pending) session's pin button stays enabled", runningEnabled, "disabled while merely running");

  // D5: aria-pressed / aria-label / title reflect state and include the title for disambiguation.
  await mount(page, { sessions: [makeSession("aria-test", { isPinned: true, title: "My Thread" })] });
  const ariaInfo = await subjectEval(page, (el) => {
    const btn = el.shadowRoot.querySelector("[data-session-id='aria-test'] .pin-btn");
    return { pressed: btn.getAttribute("aria-pressed"), label: btn.getAttribute("aria-label"), title: btn.getAttribute("title") };
  });
  check("D5: pinned button has aria-pressed=true and a title-qualified label", ariaInfo.pressed === "true" && ariaInfo.label.includes("My Thread"), JSON.stringify(ariaInfo));

  // D4: clicking the pin button fires exactly one bubbling+composed set-session-pinned event,
  // carrying the desired (inverted) state, and never fires select-session.
  await mount(page, { sessions: [makeSession("click-test", { isPinned: false })] });
  await subjectEval(page, (el) => { el.shadowRoot.querySelector("[data-session-id='click-test'] .pin-btn").click(); });
  const clickEvents = await page.evaluate(() => window.__events);
  check("D4: exactly one set-session-pinned event on click", clickEvents.filter((e) => e.type === "set-session-pinned").length === 1, JSON.stringify(clickEvents));
  check("D4: desired state is the inverse of current (false -> true)", clickEvents[0]?.detail?.isPinned === true, JSON.stringify(clickEvents[0]));
  check("D4: event bubbles and composed", clickEvents[0]?.bubbles === true && clickEvents[0]?.composed === true, JSON.stringify(clickEvents[0]));
  check("D4: clicking the pin button never selects the session", !clickEvents.some((e) => e.type === "select-session"), JSON.stringify(clickEvents));

  // D4: toggling the other direction (pinned -> unpin desired false).
  await mount(page, { sessions: [makeSession("click-test-2", { isPinned: true })] });
  await subjectEval(page, (el) => { el.shadowRoot.querySelector("[data-session-id='click-test-2'] .pin-btn").click(); });
  const unpinEvents = await page.evaluate(() => window.__events);
  check("D4: desired state is the inverse of current (true -> false)", unpinEvents[0]?.detail?.isPinned === false, JSON.stringify(unpinEvents[0]));

  // D4: existing menu (rename/archive/delete order) and unread/active regressions untouched by the pin button.
  await mount(page, { sessions: [makeSession("menu-test", { hasUnread: true })] });
  await subjectEval(page, (el) => { el.shadowRoot.querySelector("[data-session-id='menu-test'] .menu-btn").click(); return el.updateComplete; });
  const menuLabels = await subjectEval(page, (el) => [...el.shadowRoot.querySelectorAll(".dropdown-item")].map((b) => b.textContent.trim()));
  check("D6 regression: menu order is still 名称変更→アーカイブ→削除", JSON.stringify(menuLabels) === JSON.stringify(["名称変更", "アーカイブ", "削除"]), menuLabels.join(","));
  const unreadDotPresent = await subjectEval(page, (el) => Boolean(el.shadowRoot.querySelector("[data-session-id='menu-test'] .unread-dot")));
  check("D6 regression: unread dot still renders alongside the pin button", unreadDotPresent, "missing");
}

async function runInteractiveChecks(page) {
  // D3: real :hover / :focus-within visibility, driven over CDP (not synthetic events).
  await mount(page, { sessions: [makeSession("hover-A", { isPinned: false }), makeSession("pinned-B", { isPinned: true })] });

  const opacityOf = async (selector) => page.locator("#subject").evaluate((el, sel) => {
    const btn = el.shadowRoot.querySelector(sel);
    return Number(getComputedStyle(btn).opacity);
  }, selector);

  check("D3: unpinned row's pin button starts at opacity 0", (await opacityOf("[data-session-id='hover-A'] .pin-btn")) === 0, await opacityOf("[data-session-id='hover-A'] .pin-btn"));
  check("D3: pinned row's pin button is always opacity 1", (await opacityOf("[data-session-id='pinned-B'] .pin-btn")) === 1, await opacityOf("[data-session-id='pinned-B'] .pin-btn"));

  const rowBox = await page.locator("#subject").evaluate((el) => {
    const row = el.shadowRoot.querySelector("[data-session-id='hover-A']");
    const rect = row.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
  await page.waitForTimeout(220);
  check("D3: real mouse hover over the row reveals the pin button (opacity 1)", (await opacityOf("[data-session-id='hover-A'] .pin-btn")) === 1, await opacityOf("[data-session-id='hover-A'] .pin-btn"));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(220);
  check("D3: moving the mouse away hides it again (opacity 0)", (await opacityOf("[data-session-id='hover-A'] .pin-btn")) === 0, await opacityOf("[data-session-id='hover-A'] .pin-btn"));

  // Real Tab focus must reach the pin button and reveal it via :focus-within, even though it sat at opacity 0.
  await page.locator("#subject").evaluate((el) => {
    const input = el.shadowRoot.querySelector("input[type=search]");
    input.focus();
  });
  let reachedPinButton = false;
  for (let i = 0; i < 12 && !reachedPinButton; i += 1) {
    await page.keyboard.press("Tab");
    reachedPinButton = await page.locator("#subject").evaluate((el) => {
      const active = el.shadowRoot.activeElement;
      return Boolean(active && active.classList.contains("pin-btn") && active.closest("[data-session-id='hover-A']"));
    });
  }
  check("D3: Tab order reaches the hidden (opacity 0) pin button", reachedPinButton, "never reached via Tab");
  await page.waitForTimeout(220); // Let the opacity transition settle before reading it.
  check("D3: a Tab-focused pin button becomes visible (focus-within)", reachedPinButton && (await opacityOf("[data-session-id='hover-A'] .pin-btn")) === 1, await opacityOf("[data-session-id='hover-A'] .pin-btn"));

  // D4: Enter/Space on a focused pin button toggle it and never select the session; no custom double-fire.
  await page.evaluate(() => { window.__events = []; });
  await page.keyboard.press("Enter");
  let events = await page.evaluate(() => window.__events);
  check("D4: Enter on the focused pin button fires exactly one set-session-pinned", events.filter((e) => e.type === "set-session-pinned").length === 1, JSON.stringify(events));
  check("D4: Enter never fires select-session", !events.some((e) => e.type === "select-session"), JSON.stringify(events));
}

async function main() {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("remote-debugging-port", String(CDP_PORT));
  await app.whenReady();
  const harnessDir = writeHarness();
  const win = new BrowserWindow({ show: false, webPreferences: {} });
  await win.loadFile(path.join(harnessDir, "index.html"));

  let browser;
  try {
    const connected = await connectHarnessPage();
    browser = connected.browser;
    const page = connected.page;
    await runStructuralChecks(page);
    await runInteractiveChecks(page);
  } finally {
    await browser?.close().catch(() => {});
    win.destroy();
    fs.rmSync(harnessDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "test/artifacts/verify-chat-history-pins.json"),
    JSON.stringify({ electron: process.versions.electron, platform: process.platform, total: results.length, failed: failed.length, results }, null, 2)
  );
  console.log(`verify-chat-history-pins: ${results.length - failed.length}/${results.length} checks passed`);
  app.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(2);
});
