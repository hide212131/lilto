const assert = require("node:assert/strict");

async function verifyToolGroups(page, baseline = false) {
  const fixture = page.locator("#tool-groups-fixture");
  await page.evaluate(async () => {
    const list = document.createElement("lilt-message-list");
    list.id = "tool-groups-fixture";
    list.style.cssText = "position:fixed;inset:20px;z-index:9999;background:white;overflow:auto";
    document.body.append(list);
    list.messages = [{
      id: "tool-groups", role: "assistant", pending: true, createdAt: Date.now(),
      progress: {
        statusLines: [], pendingLabel: "Agentの応答2",
        tools: Array.from({ length: 5 }, (_, i) => ({
          toolName: "shell", detail: `echo command-${i + 1}`,
          ...(i === 0 ? { label: "Agentの応答1" } : {})
        }))
      }
    }];
    await list.updateComplete;
  });
  try {
    if (baseline) {
      assert.equal(await fixture.locator(".tool-disclosure").count(), 5);
      await page.screenshot({ path: "test/artifacts/tool-groups-before.png" });
      console.log("✓ Live UI reproduced five separate command icons");
      return;
    }
    const groups = fixture.locator(".tool-disclosure");
    assert.equal(await groups.count(), 1);
    const summary = groups.first().locator(":scope > summary");
    assert.match(await summary.textContent(), /Agentの応答1/);
    const boxes = await summary.evaluate((element) => {
      const label = element.querySelector(".tool-label").getBoundingClientRect();
      const icon = element.querySelector("svg").getBoundingClientRect();
      return { labelBottom: label.bottom, labelTop: label.top, labelRight: label.right, iconTop: icon.top, iconBottom: icon.bottom, iconLeft: icon.left };
    });
    assert.ok(boxes.iconTop < boxes.labelBottom && boxes.iconBottom > boxes.labelTop);
    assert.ok(boxes.iconLeft >= boxes.labelRight);
    assert.equal(await fixture.locator(".tool-console:visible").count(), 0);
    await page.screenshot({ path: "test/artifacts/tool-groups-collapsed.png" });
    await summary.click();
    assert.equal(await fixture.locator(".tool-console:visible").count(), 5);
    assert.deepEqual((await fixture.locator(".tool-console").allTextContents()).map((text) => text.trim()),
      Array.from({ length: 5 }, (_, i) => `> echo command-${i + 1}`));
    // Streaming a command into an open group must preserve its disclosure state.
    await fixture.evaluate(async (list) => {
      const message = list.messages[0];
      list.messages = [{ ...message, progress: { ...message.progress,
        pendingLabel: "Agentの応答3",
        tools: [...message.progress.tools, { toolName: "shell", detail: "echo command-6" },
          { label: "Agentの応答2", toolName: "shell", detail: "echo next-group" }]
      } }];
      await list.updateComplete;
    });
    assert.equal(await groups.count(), 2);
    assert.equal(await groups.first().locator(".tool-console:visible").count(), 6);
    assert.equal(await groups.nth(1).locator(".tool-console:visible").count(), 0);
    await summary.click();
    assert.equal(await fixture.locator(".tool-console:visible").count(), 0);
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await groups.first().locator(".tool-console:visible").count(), 6);
    await page.screenshot({ path: "test/artifacts/tool-groups-expanded.png" });
    await fixture.evaluate(async (list) => { list.showToolExecutionDetails = true; await list.updateComplete; });
    assert.equal(await fixture.locator(".tool-console:visible").count(), 7);
    // Commands without preceding commentary still have one usable disclosure.
    await fixture.evaluate(async (list) => {
      list.showToolExecutionDetails = false;
      list.messages = [{ ...list.messages[0], pending: false, text: "完了しました", progress: {
        statusLines: [], tools: [{ toolName: "shell", detail: "echo first" }, { toolName: "shell", detail: "echo second" }]
      } }];
      await list.updateComplete;
    });
    assert.equal(await groups.count(), 1);
    await summary.click();
    assert.equal(await fixture.locator(".tool-console:visible").count(), 2);
    console.log("✓ One inline icon opens each commentary's command group; streaming, keyboard, settings and unlabeled commands verified");
  } finally {
    await fixture.evaluate((element) => element.remove());
  }
}

module.exports = { verifyToolGroups };

if (require.main === module) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { _electron } = require("playwright-core");
  const { execFileSync } = require("node:child_process");
  (async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-tool-groups-"));
    const env = { ...process.env, LILTO_E2E_MOCK: "1", LILTO_PROVIDER_SETTINGS_PATH: path.join(profile, "settings.json") };
    delete env.ELECTRON_RUN_AS_NODE;
    let electron;
    try {
      electron = await _electron.launch({ args: [".", "--remote-debugging-port=9337", `--user-data-dir=${profile}`], env });
      const page = await electron.firstWindow();
      await page.locator("lilt-app").waitFor();
      execFileSync(process.execPath, ["scripts/live-ui-manual-verification.js", "9337", "wait-app"], { stdio: "inherit" });
      await verifyToolGroups(page, process.argv.includes("--baseline"));
    } finally {
      await electron?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
