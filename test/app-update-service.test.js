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
