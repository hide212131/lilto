const { EventEmitter } = require("node:events");
const vm = require("node:vm");

/**
 * Fake WebFrameMain. By default it REALLY runs the page-side program in a vm context that stands in
 * for the page's JS world (window === the context global), so the serializer/guard code is exercised
 * for real. Tests can replace `exec` (hang, delay, navigate mid-flight) to model races.
 */
/** Like Chromium: frame tree node ids are unique across every WebContents. */
let frameTreeNodeCounter = 0;
const nextFrameTreeNodeId = () => (frameTreeNodeCounter += 1);

class FakeFrame {
  constructor(wc, { frameTreeNodeId, url = "", name = "", parent = null, processId = 1, origin } = {}) {
    this.wc = wc;
    this.frameTreeNodeId = frameTreeNodeId;
    this.processId = processId;
    this.routingId = 1;
    this.name = name;
    this.parent = parent;
    this.detached = false;
    this.url = url;
    this.explicitOrigin = origin;
    this.executed = [];
    this.exec = null;
    this.newPage();
  }
  get origin() {
    if (this.explicitOrigin !== undefined) return this.explicitOrigin;
    try { return new URL(this.url).origin; } catch { return "null"; }
  }
  get framesInSubtree() {
    if (this.detached) throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    return this.wc.allFrames().filter((f) => !f.detached && f.isDescendantOrSelf(this));
  }
  isDescendantOrSelf(root) {
    for (let f = this; f; f = f.parent) if (f === root) return true;
    return false;
  }
  newPage() {
    this.page = vm.createContext({ document: { title: "T" }, TextEncoder, console });
    vm.runInContext("var window = globalThis;", this.page);
  }
  /** Commit a new document in this frame (like a real navigation: new world, new routing id). */
  navigate(url, { start = true } = {}) {
    if (start) this.wc.emit("did-start-navigation", { frame: this, isMainFrame: this.parent === null, isSameDocument: false, url });
    this.url = url;
    this.routingId += 1;
    this.newPage();
    this.wc.emit("did-frame-navigate", {}, url, 200, "OK", this.parent === null, this.processId, this.routingId);
  }
  async executeJavaScript(code, userGesture) {
    if (this.detached) throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    this.executed.push({ code, userGesture });
    if (this.exec) return this.exec(code, () => this.run(code));
    return this.run(code);
  }
  run(code) {
    return vm.runInContext(code, this.page);
  }
}

/** Fake WebContents: records calls and lets tests drive events and page runtime results. */
class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.url = "";
    this.title = "";
    this.loading = false;
    this.destroyed = false;
    this.calls = [];
    this.inputs = [];
    this.history = [];
    this.index = -1;
    this.pageHandlers = { settleFrames: async () => ({ ok: true }) };
    this.loadBehavior = (url) => ({ url });
    this.windowOpenHandler = null;
    this.frameList = [];
    this.mainFrame = new FakeFrame(this, { frameTreeNodeId: nextFrameTreeNodeId() });
    this.frameList.push(this.mainFrame);
    this.closeOptions = null;
    this.destroyDelayMs = 0;
    this.navigationHistory = {
      canGoBack: () => this.index > 0,
      canGoForward: () => this.index >= 0 && this.index < this.history.length - 1,
      goBack: () => { this.index -= 1; this.url = this.history[this.index]; setImmediate(() => this.emit("did-stop-loading")); },
      goForward: () => { this.index += 1; this.url = this.history[this.index]; setImmediate(() => this.emit("did-stop-loading")); }
    };
  }
  isDestroyed() { return this.destroyed; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  isLoading() { return this.loading; }
  allFrames() { return this.frameList; }
  addFrame(options) {
    const frame = new FakeFrame(this, { frameTreeNodeId: nextFrameTreeNodeId(), parent: this.mainFrame, ...options });
    this.frameList.push(frame);
    return frame;
  }
  close(options) {
    this.closeOptions = options ?? null;
    this.calls.push("close");
    const finish = () => { this.destroyed = true; this.emit("destroyed"); };
    if (this.destroyDelayMs > 0) setTimeout(finish, this.destroyDelayMs);
    else finish();
  }
  reload() { this.calls.push("reload"); setImmediate(() => this.emit("did-stop-loading")); }
  focus() {}
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  async loadURL(url) {
    this.calls.push(`loadURL:${url}`);
    const behavior = this.loadBehavior(url);
    this.emit("did-start-navigation", { frame: this.mainFrame, isMainFrame: true, isSameDocument: false });
    if (behavior.fail) {
      this.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", url, true);
      throw new Error("ERR_NAME_NOT_RESOLVED (-105)");
    }
    if (behavior.hang) return new Promise(() => {});
    this.history = this.history.slice(0, this.index + 1).concat(url);
    this.index += 1;
    this.url = url;
    this.mainFrame.url = url;
    this.mainFrame.routingId += 1;
    this.mainFrame.newPage();
    this.title = behavior.title || "t";
    this.emit("did-navigate", {}, url, 200, "OK");
    this.emit("dom-ready");
    this.emit("did-stop-loading");
  }
  async executeJavaScriptInIsolatedWorld(worldId, scripts) {
    const code = scripts[0].code;
    const match = /globalThis\.__liltoBrowser\["(\w+)"\]\((.*)\);$/s.exec(code);
    const method = match[1];
    const args = JSON.parse(match[2]);
    this.calls.push(`page:${method}`);
    const handler = this.pageHandlers[method];
    if (!handler) throw new Error(`no fake page handler for ${method}`);
    return handler(args);
  }
  sendInputEvent(event) { this.inputs.push(event); }
  async insertText(text) { this.inputs.push({ type: "insertText", text }); }
  setBackgroundThrottling(allowed) { this.throttling = allowed; this.calls.push(`throttling:${allowed}`); }
  async capturePage(rect, options) {
    this.captureOptions = options ?? null;
    if (this.captureError) throw new Error(this.captureError);
    const size = this.shot || { width: 2000, height: 1000, bytes: 1000 };
    const image = {
      getSize: () => ({ width: size.width, height: size.height }),
      resize: ({ width, height }) => ({ ...image, getSize: () => ({ width, height }) }),
      toPNG: () => Buffer.alloc(size.bytes, 1)
    };
    return image;
  }
  /** Real Electron API; tests simulate "no frame presented" by leaving `framePresents` false. */
  beginFrameSubscription(onlyDirty, callback) {
    this.frameSubscriptionCallback = callback;
    if (this.framePresents) setImmediate(() => this.frameSubscriptionCallback === callback && callback({}, {}));
  }
  endFrameSubscription() {
    this.frameSubscriptionCallback = null;
  }
}

class FakeHost {
  constructor() {
    this.sent = [];
    this.views = [];
    this.attached = new Set();
    this.windowVisible = true;
    this.windowMinimized = false;
    this.windowPresent = true;
    this.windowFocused = true;
    this.hostThrottling = true;
    this.external = [];
    this.cleared = 0;
    this.zoom = 1;
    this.content = { width: 1200, height: 800 };
  }
  createView() {
    const view = { webContents: new FakeWebContents(), bounds: null, visible: false, setBounds(b) { this.bounds = b; }, setVisible(v) { this.visible = v; } };
    this.views.push(view);
    return view;
  }
  attachView(view) { this.attached.add(view); }
  detachView(view) { this.attached.delete(view); }
  getContentSize() { return this.content; }
  getZoomFactor() { return this.zoom; }
  getWindowState() { return { present: this.windowPresent, visible: this.windowVisible && !this.windowMinimized, minimized: this.windowMinimized, focused: this.windowFocused }; }
  setHostBackgroundThrottling(allowed) { this.hostThrottling = allowed; }
  /** Like Electron: a minimized window is not "visible" on macOS but still shown logically. */
  minimize() { this.windowMinimized = true; }
  restore() { this.windowMinimized = false; }
  sendToRenderer(channel, payload) { this.sent.push({ channel, payload }); }
  openExternal(url) { this.external.push(url); }
  async clearSessionData() { this.cleared += 1; }
  focusHost() {}
}

/** Fakes must be able to express `panelVisible=false && operationReady=true` (a minimized, prepared panel). */
/** Open the panel with a valid layout so the view becomes visible. */
function presentPanel(controller, overrides = {}) {
  const epoch = controller.getState().rendererEpoch || controller.beginRendererEpoch();
  const layoutRevision = controller.getState().layoutRevision;
  seqCounter += 1;
  controller.updateViewport({
    rendererEpoch: epoch, seq: seqCounter, layoutRevision,
    viewport: { x: 700, y: 50, width: 480, height: 700 }, hostViewport: { width: 1200, height: 800 },
    panelOpen: true, occluded: false, resizing: false, ...overrides
  });
}
let seqCounter = 0;

module.exports = { FakeWebContents, FakeFrame, FakeHost, presentPanel };
