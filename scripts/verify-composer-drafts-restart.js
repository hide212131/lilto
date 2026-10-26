const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { verifyComposerDrafts } = require("./verify-composer-drafts");
const { waitForAppReady } = require("./electron-playwright");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-draft-restart-"));
  let electron;
  const launch = async (sessions = []) => {
    const env = { ...process.env, LILTO_E2E_MOCK: "1", LILTO_PROVIDER_SETTINGS_PATH: path.join(profile, "settings.json") };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({ args: [".", `--user-data-dir=${profile}`], cwd: path.resolve(__dirname, ".."), env });
    const page = await electron.firstWindow();
    await waitForAppReady(page);
    // Mock turns do not persist real Codex threads. Stub conversation metadata
    // only; drafts and active selection use the production renderer and storage.
    await electron.evaluate(({ ipcMain }, sessions) => {
      for (const channel of ["list", "read", "create"]) ipcMain.removeHandler(`conversations:${channel}`);
      ipcMain.handle("conversations:list", () => ({ ok: true, conversations: sessions }));
      ipcMain.handle("conversations:read", (_event, { conversationId }) => {
        const conversation = sessions.find((session) => session.id === conversationId);
        return conversation ? { ok: true, conversation } : { ok: false };
      });
      ipcMain.handle("conversations:create", (_event, { title }) => {
        const id = `draft-${Date.now()}-${sessions.length}`;
        const conversation = { id, title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        sessions.push(conversation);
        return { ok: true, conversation };
      });
    }, sessions);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("lilt-app")?.authState);
    return page;
  };
  try {
    let page = await launch();
    page = await verifyComposerDrafts(page, async (oldPage) => {
      const sessions = await oldPage.evaluate(() => document.querySelector("lilt-app").sessions);
      await electron.close();
      return launch(sessions);
    });
    await page.screenshot({ path: "test/artifacts/composer-drafts-restart.png" });
    console.log("✓ Drafts and active conversation restored across four Electron process restarts");
  } finally {
    await electron?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
