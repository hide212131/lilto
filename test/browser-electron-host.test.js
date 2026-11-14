const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { EventEmitter } = require("node:events");

/** Load the Electron-facing module against a recording fake of the `electron` package. */
function loadWithFakeElectron() {
  const handlers = new Map();
  const created = [];
  const sessionHandlers = {};
  const power = new EventEmitter();
  const fakeSession = {
    setPermissionRequestHandler: (h) => (sessionHandlers.request = h),
    setPermissionCheckHandler: (h) => (sessionHandlers.check = h),
    setDevicePermissionHandler: (h) => (sessionHandlers.device = h),
    on: (event, h) => (sessionHandlers[event] = h),
    cleared: [],
    async clearStorageData() { this.cleared.push("storage"); },
    async clearCache() { this.cleared.push("cache"); },
    async clearAuthCache() { this.cleared.push("auth"); }
  };
  const fakeElectron = {
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    session: { fromPartition: (name) => { fakeSession.partition = name; return fakeSession; } },
    shell: { openExternal: () => {} },
    powerMonitor: power,
    BrowserWindow: class {},
    WebContentsView: class {
      constructor(options) {
        this.options = options;
        this.webContents = { setZoomFactor: (z) => (this.zoom = z), setVisualZoomLevelLimits: async () => {} };
        created.push(this);
      }
    }
  };
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === "electron" ? fakeElectron : original.call(this, request, ...rest); };
  const modulePath = path.join(__dirname, "..", "dist", "main", "embedded-browser-electron.js");
  const ipcModulePath = path.join(__dirname, "..", "dist", "main", "ipc", "browser.js");
  delete require.cache[modulePath];
  delete require.cache[ipcModulePath];
  try {
    const mod = { ...require(modulePath), ...require(ipcModulePath) };
    return { mod, handlers, created, sessionHandlers, fakeSession, power };
  } finally { Module._load = original; }
}

test("page view: sandboxed, isolated, no preload, no node, dialogs disabled, zoom locked", () => {
  const { mod, created, fakeSession } = loadWithFakeElectron();
  const host = mod.createElectronBrowserHost(() => null);
  host.createView();
  const prefs = created[0].options.webPreferences;
  assert.deepEqual(prefs, { partition: "lilto-links", sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, disableDialogs: true });
  assert.equal("preload" in prefs, false);
  assert.equal(created[0].zoom, 1);
  assert.equal(fakeSession.partition, "lilto-links");
  assert.equal(prefs.partition.startsWith("persist:"), false, "in-memory session");
});

test("session denies every permission/device request and cancels downloads", () => {
  const { mod, sessionHandlers } = loadWithFakeElectron();
  mod.createElectronBrowserHost(() => null).createView();
  for (const permission of ["media", "geolocation", "notifications", "clipboard-read", "midi", "fullscreen"]) {
    let granted = "unset";
    sessionHandlers.request({}, permission, (value) => (granted = value));
    assert.equal(granted, false, permission);
  }
  assert.equal(sessionHandlers.check({}, "media"), false);
  assert.equal(sessionHandlers.device({}), false);
  let prevented = false;
  sessionHandlers["will-download"]({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
});

test("clearSessionData wipes storage, cache and auth cache of the browser partition only", async () => {
  const { mod, fakeSession } = loadWithFakeElectron();
  await mod.createElectronBrowserHost(() => null).clearSessionData();
  assert.deepEqual(fakeSession.cleared, ["storage", "cache", "auth"]);
  assert.equal(fakeSession.partition, "lilto-links");
});

function fakeWindow() {
  const webContents = { mainFrame: { id: "main" }, isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

test("IPC handlers accept only the host window's main frame and validate payloads", async () => {
  const { mod, handlers } = loadWithFakeElectron();
  const calls = [];
  const controller = {
    getState: () => ({ revision: 1 }),
    setPresentation: (p) => calls.push(["presentation", p]),
    updateViewport: (u) => calls.push(["viewport", u]),
    navigateByUser: async (url) => calls.push(["navigate", url]),
    goBack: async () => calls.push(["back"]), goForward: async () => calls.push(["forward"]), reloadByUser: async () => calls.push(["reload"]),
    openCurrentExternally: () => calls.push(["external"]), takeControl: () => calls.push(["take"]), allowAgentControl: () => calls.push(["allow"])
  };
  const win = fakeWindow();
  mod.registerBrowserIpcHandlers(controller, () => win);
  assert.deepEqual([...handlers.keys()].sort(), ["browser:allowAgentControl", "browser:back", "browser:forward", "browser:getState", "browser:navigate", "browser:openExternal", "browser:reload", "browser:setPresentation", "browser:takeControl", "browser:updateViewport"]);
  const good = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const embedded = { sender: { other: true }, senderFrame: { id: "page" } };
  const subframe = { sender: win.webContents, senderFrame: { id: "iframe" } };
  for (const channel of handlers.keys()) {
    for (const bad of [embedded, subframe]) {
      const result = await handlers.get(channel)(bad, { url: "https://x.example", open: true, occluded: false, resizing: false });
      assert.equal(result.ok, false, `${channel} must reject untrusted senders`);
    }
  }
  assert.equal(calls.length, 0, "nothing reached the controller from untrusted senders");

  assert.equal((await handlers.get("browser:navigate")(good, { url: "https://example.com/" })).ok, true);
  await handlers.get("browser:navigate")(good, null);
  assert.deepEqual(calls.at(-1), ["navigate", ""]);
  assert.equal((await handlers.get("browser:setPresentation")(good, { open: "yes" })).ok, false);
  assert.equal((await handlers.get("browser:setPresentation")(good, { open: true, occluded: false, resizing: false })).ok, true);
  assert.equal((await handlers.get("browser:updateViewport")(good, { seq: NaN })).ok, false);
  const viewport = { rendererEpoch: "e", seq: 1, layoutRevision: 1, viewport: { x: 0, y: 0, width: 1, height: 1 }, hostViewport: { width: 2, height: 2 }, panelOpen: true, occluded: false, resizing: false };
  assert.equal((await handlers.get("browser:updateViewport")(good, viewport)).ok, true);
  // openExternal takes no URL argument: the controller uses its own current URL
  await handlers.get("browser:openExternal")(good, { url: "https://evil.example" });
  assert.deepEqual(calls.at(-1), ["external"]);
});

test("window events drive the controller; the controller outlives the window 'closed' event", () => {
  const { mod } = loadWithFakeElectron();
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  const events = [];
  let minimized = false;
  window.isMinimized = () => minimized;
  const controller = {
    primeChromeOffset: () => events.push("prime"),
    onWindowGeometryChanged: () => events.push("geometry"), onWindowHidden: () => events.push("hidden"), onWindowShown: () => events.push("shown"),
    onWindowMinimized: () => events.push("minimized"), onWindowRestored: () => events.push("restored"),
    beginRendererEpoch: () => events.push("epoch"), dispose: () => events.push("dispose")
  };
  mod.attachControllerToWindow(controller, window);
  for (const name of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) window.emit(name);
  window.emit("hide");
  minimized = true; window.emit("minimize"); window.emit("hide"); // a hide event that is only a minimize side effect is ignored
  minimized = false; window.emit("show"); window.emit("restore");
  window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  window.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  window.webContents.emit("zoom-changed");
  window.emit("closed");
  assert.deepEqual(events, ["prime", "geometry", "geometry", "geometry", "geometry", "geometry", "hidden", "minimized", "prime", "shown", "restored", "epoch", "geometry"]);
});

test("link navigation: http(s) links go to the controller, everything else is dropped; the host page never navigates", () => {
  const { installLinkNavigation } = require("../dist/main/link-navigation.js");
  const window = { webContents: new EventEmitter() };
  let openHandler;
  window.webContents.setWindowOpenHandler = (h) => (openHandler = h);
  const opened = [];
  installLinkNavigation(window, { openLinkFromHost: (url) => opened.push(url) });
  const nav = (url) => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; window.webContents.emit("will-navigate", e, url); return e.prevented; };
  assert.equal(nav("https://example.com/a"), true);
  assert.equal(nav("javascript:alert(1)"), true);
  assert.equal(nav("file:///etc/passwd"), true);
  assert.equal(nav("mailto:a@b.c"), true);
  assert.deepEqual(opened, ["https://example.com/a"]);
  assert.deepEqual(openHandler({ url: "https://example.com/blank" }), { action: "deny" });
  assert.deepEqual(openHandler({ url: "data:text/html,x" }), { action: "deny" });
  assert.deepEqual(opened, ["https://example.com/a", "https://example.com/blank"]);
});

test("explicit hide goes through the controller first; minimize never expires anything", () => {
  const { mod } = loadWithFakeElectron();
  const calls = [];
  const window = { hide: () => calls.push("window.hide") };
  mod.hideWindowExplicitly({ onWindowHidden: () => calls.push("controller.hidden") }, window);
  assert.deepEqual(calls, ["controller.hidden", "window.hide"]);
  mod.hideWindowExplicitly(null, window);
  assert.equal(calls.at(-1), "window.hide");
});

test("host window state is one consistent read and background throttling follows the host window", () => {
  const { mod } = loadWithFakeElectron();
  const throttling = [];
  const window = { isDestroyed: () => false, isVisible: () => false, isMinimized: () => true, isFocused: () => false, webContents: { isDestroyed: () => false, setBackgroundThrottling: (v) => throttling.push(v) } };
  const host = mod.createElectronBrowserHost(() => window);
  assert.deepEqual(host.getWindowState(), { present: true, visible: false, minimized: true, focused: false });
  host.setHostBackgroundThrottling(false);
  host.setHostBackgroundThrottling(true);
  assert.deepEqual(throttling, [false, true]);
  assert.deepEqual(mod.createElectronBrowserHost(() => null).getWindowState(), { present: false, visible: false, minimized: false, focused: false });
});

test("getNormalContentSize derives a content estimate from getNormalBounds using an offset measured earlier while not minimized (Issue #42 W3)", () => {
  const { mod } = loadWithFakeElectron();
  let minimized = false;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    getContentBounds: () => (minimized ? { width: 0, height: 0 } : { width: 1000, height: 700 }),
    getBounds: () => (minimized ? { width: 0, height: 0 } : { width: 1016, height: 739 }),
    getNormalBounds: () => ({ width: 1016, height: 739 })
  };
  const host = mod.createElectronBrowserHost(() => window);
  assert.equal(host.getNormalContentSize(), null, "no offset measured yet");
  assert.deepEqual(host.getContentSize(), { width: 1000, height: 700 }, "measures while not minimized (caches the chrome offset as a side effect)");
  minimized = true;
  assert.deepEqual(host.getContentSize(), { width: 0, height: 0 }, "collapses while minimized, as observed on Windows");
  assert.deepEqual(host.getNormalContentSize(), { width: 1000, height: 700 }, "still derivable from getNormalBounds() minus the cached offset");
});

test("powerMonitor lock/suspend events reach the controller and are removed on cleanup", () => {
  const { mod, power } = loadWithFakeElectron();
  const events = [];
  const controller = { onSystemLocked: () => events.push("lock"), onSystemUnlocked: () => events.push("unlock"), onSystemSuspend: () => events.push("suspend"), onSystemResume: () => events.push("resume") };
  const detach = mod.attachControllerToPowerMonitor(controller);
  for (const name of ["lock-screen", "unlock-screen", "suspend", "resume"]) power.emit(name);
  assert.deepEqual(events, ["lock", "unlock", "suspend", "resume"]);
  detach();
  power.emit("lock-screen");
  assert.equal(events.length, 4);
});
