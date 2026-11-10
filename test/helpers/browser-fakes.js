const { EventEmitter } = require("node:events");

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
    this.pageHandlers = {};
    this.loadBehavior = (url) => ({ url });
    this.windowOpenHandler = null;
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
  close() { this.destroyed = true; this.calls.push("close"); }
  reload() { this.calls.push("reload"); setImmediate(() => this.emit("did-stop-loading")); }
  focus() {}
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  async loadURL(url) {
    this.calls.push(`loadURL:${url}`);
    const behavior = this.loadBehavior(url);
    this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    if (behavior.fail) {
      this.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", url, true);
      throw new Error("ERR_NAME_NOT_RESOLVED (-105)");
    }
    if (behavior.hang) return new Promise(() => {});
    this.history = this.history.slice(0, this.index + 1).concat(url);
    this.index += 1;
    this.url = url;
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
  async capturePage() {
    const size = this.shot || { width: 2000, height: 1000, bytes: 1000 };
    const image = {
      getSize: () => ({ width: size.width, height: size.height }),
      resize: ({ width, height }) => ({ ...image, getSize: () => ({ width, height }) }),
      toPNG: () => Buffer.alloc(size.bytes, 1)
    };
    return image;
  }
}

class FakeHost {
  constructor() {
    this.sent = [];
    this.views = [];
    this.attached = new Set();
    this.windowVisible = true;
    this.windowFocused = true;
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
  isWindowVisible() { return this.windowVisible; }
  isWindowFocused() { return this.windowFocused; }
  sendToRenderer(channel, payload) { this.sent.push({ channel, payload }); }
  openExternal(url) { this.external.push(url); }
  async clearSessionData() { this.cleared += 1; }
  focusHost() {}
}

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

module.exports = { FakeWebContents, FakeHost, presentPanel };
