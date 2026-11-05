const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { AppUpdateService } = require("../dist/main/app-update-service.js");

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  allowDowngrade = true;
  checkCalls = 0;
  downloadCalls = 0;
  installCalls = 0;

  checkForUpdates() {
    this.checkCalls++;
    return Promise.resolve().then(() => {
      this.emit("update-available", { version: "0.1.6" });
      return { updateInfo: { version: "0.1.6" } };
    });
  }

  downloadUpdate() {
    this.downloadCalls++;
    return Promise.resolve().then(() => {
      this.emit("download-progress", { percent: 40 });
      this.emit("update-downloaded", { version: "0.1.6" });
      return ["installer.exe"];
    });
  }

  quitAndInstall(silent, runAfter) {
    this.installCalls++;
    this.installArgs = [silent, runAfter];
  }
}

test("Windows update service requires consent before download and installs once", async () => {
  const updater = new FakeUpdater();
  const states = [];
  const service = new AppUpdateService({
    logger: { info() {}, error() {} },
    currentVersion: "0.1.5",
    supported: true,
    updater,
    publish: (state) => states.push(state)
  });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.autoRunAppAfterInstall, true);
  await Promise.all([service.check("startup"), service.check("manual")]);
  assert.equal(updater.checkCalls, 1);
  assert.equal(service.getSnapshot().status, "available");
  assert.equal(service.getSnapshot().targetVersion, "0.1.6");
  assert.equal(updater.downloadCalls, 0);

  await service.download();
  assert.equal(service.getSnapshot().status, "downloaded");
  assert.equal(service.getSnapshot().progress, 100);
  await service.install();
  assert.equal(updater.installCalls, 1);
  assert.deepEqual(updater.installArgs, [false, true]);
  assert.ok(states.every((state, index) => index === 0 || state.revision > states[index - 1].revision));
  await assert.rejects(service.install(), /インストールできる更新がありません/);
});

function createPollingService(updater = new FakeUpdater(), supported = true) {
  return new AppUpdateService({
    logger: { info() {}, error() {} }, currentVersion: "0.1.5",
    supported, updater, publish() {}
  });
}

async function flushPolling() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test("polls once at startup and every six hours, without duplicate timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const updater = new FakeUpdater();
  const service = createPollingService(updater);
  t.after(() => service.stopPolling());
  service.startPolling();
  service.startPolling();
  await flushPolling();
  assert.equal(updater.checkCalls, 1);
  t.mock.timers.tick(6 * 60 * 60 * 1000 - 1);
  assert.equal(updater.checkCalls, 1);
  t.mock.timers.tick(1);
  await flushPolling();
  assert.equal(updater.checkCalls, 2);
  assert.equal(service.getSnapshot().source, "poll");
  assert.equal(updater.downloadCalls, 0);
  service.stopPolling();
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(updater.checkCalls, 2);
});

test("failed polls back off to twelve then twenty-four hours and reset after success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hour = 60 * 60 * 1000;
  const updater = new FakeUpdater();
  updater.checkForUpdates = () => { updater.checkCalls++; return Promise.reject(new Error("429")); };
  const service = createPollingService(updater);
  t.after(() => service.stopPolling());
  service.startPolling();
  await flushPolling();
  t.mock.timers.tick(12 * hour - 1);
  assert.equal(updater.checkCalls, 1);
  t.mock.timers.tick(1);
  await flushPolling();
  assert.equal(updater.checkCalls, 2);
  t.mock.timers.tick(24 * hour);
  await flushPolling();
  assert.equal(updater.checkCalls, 3);
  updater.checkForUpdates = FakeUpdater.prototype.checkForUpdates;
  t.mock.timers.tick(24 * hour);
  await flushPolling();
  assert.equal(updater.checkCalls, 4);
  t.mock.timers.tick(6 * hour);
  await flushPolling();
  assert.equal(updater.checkCalls, 5);
});

test("unsupported apps never poll; stopping during a request prevents rescheduling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const updater = new FakeUpdater();
  createPollingService(updater, false).startPolling();
  assert.equal(updater.checkCalls, 0);
  let resolve;
  updater.checkForUpdates = () => { updater.checkCalls++; return new Promise((done) => { resolve = done; }); };
  const service = createPollingService(updater);
  service.startPolling();
  service.stopPolling();
  resolve(null);
  await flushPolling();
  t.mock.timers.tick(48 * 60 * 60 * 1000);
  assert.equal(updater.checkCalls, 1);
});
