const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");
const { BROWSER_IPC } = require("../dist/shared/browser.js");

const root = path.resolve(__dirname, "..");
// Normalize CRLF: Windows checkouts (autocrlf) would otherwise break the
// line-anchored regex assertions below even though the source is identical.
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("preload exposes only fixed browser methods and its inlined channel names match BROWSER_IPC", () => {
  const preload = read("src/preload.ts");
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\("(browser:[A-Za-z]+)"/g)].map((m) => m[1]).sort();
  const expected = Object.values(BROWSER_IPC).filter((c) => c !== BROWSER_IPC.stateChanged).sort();
  assert.deepEqual(channels, expected);
  assert.match(preload, new RegExp(`BROWSER_STATE_CHANGED_CHANNEL = "${BROWSER_IPC.stateChanged}"`));
  assert.equal(/invoke:\s*\(/.test(preload), false, "no generic invoke(channel) bridge");
  assert.equal(/openExternal:[^\n]*invoke\("browser:openExternal"\)/.test(preload), true, "openExternal takes no URL");
});

test("settings modal has the Browser tab with both options, the notice text and the stop warning", () => {
  const modal = read("src/renderer/components/settings-modal.ts");
  assert.match(modal, /内蔵ブラウザと AI のブラウザ連携を有効にする/);
  assert.match(modal, /AI がブラウザを使うときにパネルを自動で開く/);
  assert.match(modal, /自動表示を無効にした場合は、操作前にパネルを開いてください。認証は外部ブラウザを使う場合があります。/);
  assert.match(modal, /実行中の AI 処理は停止します/);
  assert.match(modal, /\?disabled=\$\{!this\._browserEnabled \|\| this\._browserSaving\}/, "auto-open is disabled (value kept) while OFF");
  assert.match(modal, /browserSettings: \{ enabled: this\._browserEnabled, autoOpenOnToolUse: this\._browserAutoOpen \}/);
});

test("dialogs hide the native page and wait for Main's ACK before drawing; legacy overlay artifacts are gone", () => {
  const app = read("src/renderer/app.ts");
  assert.match(app, /_hideBrowserForDialog[\s\S]*await window\.lilto\.browser\.setPresentation\(\{ open: true, occluded: true/);
  assert.equal(/settingsOpen = true/.test(app.replace(/private async _showSettings\(\)[\s\S]*?\n  }\n/, "")), false, "settings only open through _showSettings");
  const link = read("src/main/link-navigation.ts");
  for (const gone of ["lilto.invalid", "toolbarHtml", "toolbarHeight", "data:text/html"]) assert.equal(link.includes(gone), false, gone);
  assert.match(app, /role="separator"/);
  assert.match(app, /aria-valuenow/);
});

/** Run BrowserLayoutSync (real module code) against a stub DOM. */
function loadLayout() {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, "src/renderer/browser-layout.ts")], bundle: true, format: "cjs", platform: "node", write: false });
  const store = new Map();
  const rafQueue = [];
  const listeners = new Map();
  const sandbox = {
    module: { exports: {} }, exports: {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    window: {
      innerWidth: 1200, innerHeight: 800,
      addEventListener: (n, f) => listeners.set(n, f), removeEventListener: (n) => listeners.delete(n), visualViewport: null
    },
    document: { documentElement: {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (f) => { rafQueue.push(f); return rafQueue.length; },
    cancelAnimationFrame: () => {}
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(out.outputFiles[0].text, sandbox);
  const runFrame = () => { const f = rafQueue.splice(0); f.forEach((fn) => fn()); };
  return { mod: sandbox.module.exports, store, runFrame, window: sandbox.window, listeners };
}

test("panel width persistence: default, clamp, stored preference, corrupt values", () => {
  const { mod, store } = loadLayout();
  assert.equal(mod.loadPreferredPanelWidth(), 480);
  mod.savePreferredPanelWidth(5000);
  assert.equal(store.get("lilto-browser-panel-width.v1"), "960");
  mod.savePreferredPanelWidth(10);
  assert.equal(store.get("lilto-browser-panel-width.v1"), "320");
  store.set("lilto-browser-panel-width.v1", "640");
  assert.equal(mod.loadPreferredPanelWidth(), 640);
  store.set("lilto-browser-panel-width.v1", "abc");
  assert.equal(mod.loadPreferredPanelWidth(), 480);
});

test("BrowserLayoutSync coalesces per frame, dedups, bumps seq, follows layoutRevision and epoch, clamps to the host viewport", () => {
  const { mod, runFrame, window } = loadLayout();
  let rect = { left: 700, top: 100, right: 1180, bottom: 780 };
  const element = { getBoundingClientRect: () => rect };
  const sent = new Proxy([], { get: (t, k) => (k === "push" ? (u) => t.push(JSON.parse(JSON.stringify(u))) : k === "at" ? (i) => t.at(i) : t[k]) });
  let presentation = { open: true, occluded: false, resizing: false };
  const sync = new mod.BrowserLayoutSync(() => element, () => presentation, (u) => sent.push(u));
  sync.attach();
  sync.schedule(); runFrame();
  assert.equal(sent.length, 0, "nothing is sent before Main issued an epoch");
  sync.setSync("e1", 3); runFrame();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].viewport, { x: 700, y: 100, width: 480, height: 680 });
  assert.equal(sent[0].rendererEpoch, "e1");
  assert.equal(sent[0].layoutRevision, 3);
  sync.schedule(); sync.schedule(); sync.schedule(); runFrame();
  assert.equal(sent.length, 1, "unchanged measurements are not re-sent");
  rect = { left: 700, top: 100, right: 1500, bottom: 900 };
  sync.schedule(); runFrame();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].viewport, { x: 700, y: 100, width: 500, height: 700 }, "clamped to the 1200x800 host viewport");
  assert.ok(sent[1].seq > sent[0].seq);
  presentation = { open: true, occluded: true, resizing: false };
  sync.schedule(); runFrame();
  assert.equal(sent.at(-1).occluded, true);
  sync.setSync("e1", 4); runFrame();
  assert.equal(sent.at(-1).layoutRevision, 4, "a new layoutRevision forces a fresh report");
  sync.setSync("e2", 4); runFrame();
  assert.equal(sent.at(-1).rendererEpoch, "e2");
  const before = sent.length;
  presentation = { open: true, occluded: false, resizing: false };
  rect = null;
  element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  sync.schedule(); runFrame();
  assert.deepEqual(sent.at(-1).viewport, { x: 0, y: 0, width: 0, height: 0 });
  assert.ok(sent.length > before);
  sync.detach();
});
