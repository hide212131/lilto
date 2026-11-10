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
    return { mod, handlers, created, sessionHandlers, fakeSession };
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
  const controller = {
    onWindowGeometryChanged: () => events.push("geometry"), onWindowHidden: () => events.push("hidden"), onWindowShown: () => events.push("shown"),
    beginRendererEpoch: () => events.push("epoch"), dispose: () => events.push("dispose")
  };
  mod.attachControllerToWindow(controller, window);
  for (const name of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) window.emit(name);
  window.emit("hide"); window.emit("minimize"); window.emit("show"); window.emit("restore");
  window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  window.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  window.webContents.emit("zoom-changed");
  window.emit("closed");
  assert.deepEqual(events, ["geometry", "geometry", "geometry", "geometry", "geometry", "hidden", "hidden", "shown", "shown", "epoch", "geometry"]);
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
