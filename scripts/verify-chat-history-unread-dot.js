/**
 * Real-DOM regression check for Issue #47 (未読ドットを実行中は抑止し、実行終了時に表示する).
 *
 * This project's `test:unit` suite runs under plain `node --test` with no DOM, so it cannot
 * render a Lit component or query a shadow root (confirmed: no jsdom/happy-dom dependency and
 * no existing test does so — every chat-history-adjacent test is a source-text assertion).
 * This script instead follows the `verify:*` convention (electron scripts/verify-*.js) already
 * used in this repo for checks that need a real Chromium DOM, and bundles
 * src/renderer/components/chat-history.ts directly with esbuild so it runs against the actual
 * component, not a reimplementation of its dot-visibility condition.
 *
 *   electron scripts/verify-chat-history-unread-dot.js
 */
const { app, BrowserWindow } = require("electron");
const esbuild = require("esbuild");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-chat-history-dom-"));
  fs.writeFileSync(path.join(dir, "chat-history.bundle.js"), bundleChatHistory());
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><body><script type="module" src="./chat-history.bundle.js"></script></body></html>`
  );
  return dir;
}

function makeSession(id, overrides = {}) {
  return { id, title: id, createdAt: 1, updatedAt: 1, hasUnread: false, messages: [], ...overrides };
}

// One scenario per row of design doc section 8's contract matrix, plus the mandatory "開始→終了"
// case that is candidate A's whole justification. `mutate` (if present) re-sets properties on the
// same element and re-checks, without ever touching hasUnread outside of what each case states.
const SCENARIOS = [
  {
    name: "未読なし・実行中でない",
    sessions: [makeSession("A")],
    runningSessionIds: [],
    expectDotA: false
  },
  {
    name: "未読あり・実行中でない",
    sessions: [makeSession("A", { hasUnread: true })],
    runningSessionIds: [],
    expectDotA: true
  },
  {
    name: "未読あり・対象が実行中",
    sessions: [makeSession("A", { hasUnread: true })],
    runningSessionIds: ["A"],
    expectDotA: false,
    expectRunningA: true
  },
  {
    name: "未読あり・別セッションだけ実行中",
    sessions: [makeSession("A", { hasUnread: true }), makeSession("B")],
    runningSessionIds: ["B"],
    expectDotA: true
  },
  {
    name: "対象の実行状態を開始→終了へ変更（hasUnreadは変えない）",
    sessions: [makeSession("A", { hasUnread: true })],
    runningSessionIds: ["A"],
    expectDotA: false,
    mutate: { runningSessionIds: [] },
    expectDotAAfterMutate: true
  },
  {
    name: "実行中に既読化した後、実行終了",
    sessions: [makeSession("A", { hasUnread: true })],
    runningSessionIds: ["A"],
    expectDotA: false,
    mutate: { sessions: [makeSession("A", { hasUnread: false })], runningSessionIds: [] },
    expectDotAAfterMutate: false
  },
  {
    name: "未読表示後に既読化",
    sessions: [makeSession("A", { hasUnread: true })],
    runningSessionIds: [],
    expectDotA: true,
    mutate: { sessions: [makeSession("A", { hasUnread: false })] },
    expectDotAAfterMutate: false
  }
];

async function runScenarios(win) {
  const script = `
    (async () => {
      const results = [];
      const itemSelector = (mode, id) => mode === "activity"
        ? \`.activity-item[data-session-id="\${id}"]\`
        : \`.session-item[data-session-id="\${id}"]\`;
      const dotPresent = (el, mode, id) =>
        Boolean(el.shadowRoot.querySelector(itemSelector(mode, id) + " .unread-dot"));
      const runningShown = (el, mode, id) =>
        Boolean(el.shadowRoot.querySelector(itemSelector(mode, id) + " .run-status"));

      for (const mode of ["list", "activity"]) {
        for (const scenario of ${JSON.stringify(SCENARIOS)}) {
          const el = document.createElement("lilt-chat-history");
          el.activityMode = mode === "activity";
          el.sessions = scenario.sessions;
          el.runningSessionIds = scenario.runningSessionIds;
          document.body.appendChild(el);
          await el.updateComplete;
          results.push({
            name: scenario.name + " [" + mode + "]",
            dotA: dotPresent(el, mode, "A"),
            expectDotA: scenario.expectDotA,
            runningA: scenario.expectRunningA === undefined ? null : runningShown(el, mode, "A"),
            expectRunningA: scenario.expectRunningA ?? null
          });
          if (scenario.mutate) {
            if (scenario.mutate.sessions) el.sessions = scenario.mutate.sessions;
            if (scenario.mutate.runningSessionIds) el.runningSessionIds = scenario.mutate.runningSessionIds;
            await el.updateComplete;
            results.push({
              name: scenario.name + " [" + mode + "] (after mutate)",
              dotA: dotPresent(el, mode, "A"),
              expectDotA: scenario.expectDotAAfterMutate,
              runningA: null,
              expectRunningA: null
            });
          }
          el.remove();
        }
      }
      return results;
    })();
  `;
  return win.webContents.executeJavaScript(script);
}

async function main() {
  app.disableHardwareAcceleration();
  await app.whenReady();
  const harnessDir = writeHarness();
  const win = new BrowserWindow({ show: false, webPreferences: {} });
  await win.loadFile(path.join(harnessDir, "index.html"));
  const caseResults = await runScenarios(win);
  for (const result of caseResults) {
    check(`${result.name}: unread-dot`, result.dotA === result.expectDotA,
      `dotA=${result.dotA} expected=${result.expectDotA}`);
    if (result.expectRunningA !== null) {
      check(`${result.name}: run-status`, result.runningA === result.expectRunningA,
        `runningA=${result.runningA} expected=${result.expectRunningA}`);
    }
  }
  win.destroy();
  fs.rmSync(harnessDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(root, "test/artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "test/artifacts/verify-chat-history-unread-dot.json"),
    JSON.stringify({ electron: process.versions.electron, total: results.length, failed: failed.length, results }, null, 2)
  );
  console.log(`verify-chat-history-unread-dot: ${results.length - failed.length}/${results.length} checks passed`);
  app.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(2);
});
