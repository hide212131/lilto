const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { verifyLinkNavigation } = require("./verify-link-navigation");
const { verifyComposerDrafts } = require("./verify-composer-drafts");
const { verifyParallelConversations } = require("./verify-parallel-conversations");
const { verifyConversationSteering } = require("./verify-conversation-steering");
const { verifyToolGroups } = require("./verify-tool-groups");
const {
  collectMessages,
  connectToElectronApp,
  resolveNamedLocator,
  waitForAppReady
} = require("./electron-playwright");

const rootDir = path.resolve(__dirname, "..");
let cdpPort = "9222";
const screenshotPath = path.join(rootDir, "test", "artifacts", "electron-e2e.png");
const mockProviderSettingsPath = path.join(rootDir, "test", "artifacts", "e2e-mock-provider-settings.json");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? String(address.port) : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error("Failed to resolve a free TCP port"));
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function shouldUseShellForCommand(commandPath) {
  if (process.platform !== "win32") return false;
  const lower = String(commandPath || "").toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

async function waitForCdpReady(timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${cdpPort}/json/version`;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for CDP endpoint: ${url}`);
}

async function getStatusText(page) {
  return ((await resolveNamedLocator(page, "status").textContent()) ?? "").trim();
}

async function getCustomSaveStatusText(page) {
  const statuses = resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator(".provider-actions .status");
  const count = await statuses.count();
  if (count === 0) {
    return "";
  }
  return ((await statuses.nth(count - 1).textContent()) ?? "").trim();
}

async function getMessagesText(page) {
  return (await collectMessages(page))
    .map((message) => message.trim())
    .filter(Boolean)
    .join("\n");
}

async function verifyConversationOrder(page) {
  const rounds = await page.evaluate(async () => {
    const app = document.querySelector("lilt-app");
    const originalMessages = app.messages;
    const createdAt = 1_792_600_000_000;
    const messages = [
      { id: "item-1", role: "user", text: "質問1", createdAt },
      { id: "item-2", role: "assistant", text: "回答1", createdAt },
      { id: "item-10", role: "user", text: "質問2", createdAt },
      { id: "item-20", role: "assistant", text: "回答2", createdAt }
    ];
    const hydrated = { id: "order-regression", messages, createdAt, updatedAt: createdAt };
    let local = { ...hydrated, messages: [messages[0], messages[2], messages[1], messages[3]] };
    const observations = [];
    try {
      for (let round = 0; round < 3; round += 1) {
        local = app._mergeHydratedSession(hydrated, local);
        app.messages = local.messages;
        await app.updateComplete;
        const list = app.shadowRoot.querySelector("lilt-message-list");
        await list.updateComplete;
        observations.push(Array.from(list.shadowRoot.querySelectorAll(".msg"), (element) => element.textContent.trim()));
      }
      return observations;
    } finally {
      app.messages = originalMessages;
      await app.updateComplete;
    }
  });
  for (const messages of rounds) {
    assert.deepEqual(messages, ["質問1", "回答1", "質問2", "回答2"]);
  }
  console.log("✓ Question/answer display order preserved across repeated history merges");
}

async function verifySidebarActivity(page) {
  const history = page.locator("#activity-contract-fixture");
  const before = await page.evaluate(async () => {
    const root = document.querySelector("lilt-app");
    const fixture = document.createElement("lilt-chat-history");
    fixture.id = "activity-contract-fixture";
    document.body.append(fixture);
    const now = Date.now();
    fixture.sessions = [
      { id: "activity-new", title: "更新が新しい", createdAt: now - 2000, updatedAt: now, hasUnread: true,
        messages: [{ id: "new-message", role: "assistant", text: "最新の本文 **強調**です。2行表示を確認するために十分長い文章を続けます。さらに追加して折り返しを確認します。", createdAt: now }] },
      { id: "activity-old", title: "古い会話", createdAt: now - 2000, updatedAt: now - 1000, hasUnread: false,
        messages: [{ id: "old-message", role: "assistant", text: "前の本文", createdAt: now - 1000 }] }
    ];
    fixture.activityPreviews = {};
    fixture.addEventListener("toggle-activity", (event) => {
      event.stopImmediatePropagation();
      fixture.activityMode = !fixture.activityMode;
    });
    await fixture.updateComplete;
    return { activeSessionId: root.activeSessionId };
  });
  try {
    await history.locator(".activity-toggle").click();
    await history.getByRole("heading", { name: "アクティビティ" }).waitFor();
    await history.locator(".activity-item").first().waitFor();
    const titles = await history.locator(".activity-title").allTextContents();
    assert.deepEqual(titles, ["更新が新しい", "古い会話"]);
    const preview = history.locator(".activity-preview").first();
    assert.match(await preview.textContent(), /最新の本文 強調です/);
    const lineClamp = await preview.evaluate((element) => getComputedStyle(element).webkitLineClamp);
    assert.equal(lineClamp, "2");
    assert.equal(await history.locator(".unread-dot").count(), 1);
    assert.equal(await preview.locator("img, script").count(), 0);
    await history.locator(".activity-toggle").click();
    await history.getByRole("heading", { name: "チャット" }).waitFor();
    const preserved = await page.evaluate(() => {
      const root = document.querySelector("lilt-app");
      const history = document.querySelector("#activity-contract-fixture");
      return { activeSessionId: root.activeSessionId, unread: history.sessions.find((s) => s.id === "activity-new").hasUnread };
    });
    assert.equal(preserved.activeSessionId, before.activeSessionId);
    assert.equal(preserved.unread, true);
    console.log("✓ Sidebar activity toggle, latest-first order, two-line preview, unread state, and safe text rendering");
  } finally {
    await page.evaluate(() => document.querySelector("#activity-contract-fixture")?.remove());
  }
}

async function injectSchedulerNotification(page, messageText, followUpInstruction) {
  await page.evaluate(
    ({ message, followUp }) => {
      const app = document.querySelector("lilt-app");
      if (!app || !app.activeSessionId) return "missing-session";
      app._bindBackendSession?.(app.activeSessionId, "agent-session-e2e");
      app._onSchedulerNotification?.({
        id: "schedule-e2e-1",
        sessionId: "agent-session-e2e",
        message,
        followUpInstruction: followUp,
        firedAt: new Date().toISOString()
      });
      return "ok";
    },
    { message: messageText, followUp: followUpInstruction ?? null }
  );
}

async function clickSettingsButton(page) {
  await resolveNamedLocator(page, "settingsButton").click();
}

async function clickNewSessionButton(page) {
  await resolveNamedLocator(page, "newSessionButton").click();
}

async function clickSettingsClose(page) {
  await resolveNamedLocator(page, "settingsClose").click();
}

async function openChatSettings(page) {
  const modal = resolveNamedLocator(page, "app").locator("lilt-settings-modal");
  await modal.locator(".settings-menu-item").nth(1).click();
  return modal;
}

async function switchToCustomProvider(page) {
  await resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator('input[value="custom-openai-completions"]')
    .check();
}

async function setSettingsInputValue(page, id, value) {
  const field = resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator(`#${id}`);
  const tagName = await field.evaluate((element) => element.tagName);
  if (tagName === "SELECT") {
    await field.evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }, value);
    return;
  }
  await field.fill(value);
}

async function setSettingsCheckboxValue(page, id, checked) {
  await resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .locator(`#${id}`)
    .setChecked(checked);
}

async function clickSaveProviderSettingsButton(page) {
  await resolveNamedLocator(page, "app")
    .locator("lilt-settings-modal")
    .getByRole("button", { name: "Save Settings" })
    .click();
}

async function fillComposerText(page, value) {
  await resolveNamedLocator(page, "composerInput").fill(value);
}

async function clickComposerSend(page) {
  await resolveNamedLocator(page, "composerSend").click();
}

async function holdComposerDictation(page) {
  await resolveNamedLocator(page, "composerDictation").dispatchEvent("pointerdown", {
    bubbles: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0
  });
}

async function releaseComposerDictation(page) {
  await resolveNamedLocator(page, "composerDictation").dispatchEvent("pointerup", {
    bubbles: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0
  });
}

async function isSendDisabled(page) {
  return await resolveNamedLocator(page, "composerSend").isDisabled();
}

async function isNewSessionDisabled(page) {
  return await resolveNamedLocator(page, "newSessionButton").isDisabled();
}

async function getMessageCount(page) {
  return await resolveNamedLocator(page, "messages").count();
}

async function getDictationStatusText(page) {
  return ((await resolveNamedLocator(page, "composerDictationStatus").textContent()) ?? "").trim();
}

async function setAppSendingState(page, isSending) {
  await page.evaluate((sending) => {
    const app = document.querySelector("lilt-app");
    if (!app) return;
    app.isSending = sending;
    app.requestUpdate?.();
  }, isSending);
}

async function waitForStatus(page, expected, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getStatusText(page);
    if (expected.some((status) => text.includes(status))) return text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for status. Expected one of: ${expected.join(", ")}. Last: "${await getStatusText(page)}"`
  );
}

async function waitForModalOpen(page, timeoutMs = 5000) {
  await resolveNamedLocator(page, "settingsModal").waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForModalClose(page, timeoutMs = 5000) {
  await resolveNamedLocator(page, "settingsModal").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function waitForSendEnabled(page, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isSendDisabled(page))) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for send button to be enabled");
}

async function waitForCustomSaveStatus(page, expectedText, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getCustomSaveStatusText(page);
    if (text.includes(expectedText)) return text;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for custom save status: "${expectedText}". Last: "${await getCustomSaveStatusText(page)}"`
  );
}

async function waitForResponse(page, expectedText, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getMessagesText(page);
    if (messages.includes(expectedText)) return messages;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const appState = await page.evaluate(() => {
    const app = document.querySelector("lilt-app");
    return app
      ? {
          isSending: app.isSending,
          loopState: app.loopState,
          pendingAssistantMessageId: app._pendingAssistantMessageId,
          currentSessionId: app._currentSessionId,
          messages: app.messages.map(({ role, text, pending, progress }) => ({ role, text, pending, progress }))
        }
      : null;
  });
  throw new Error(
    `Timed out waiting for response. Expected: "${expectedText}". Messages: "${await getMessagesText(page)}". App state: ${JSON.stringify(appState)}`
  );
}

async function waitForDictationStatus(page, expectedText, timeoutMs = 5000) {
  const expectedTexts = Array.isArray(expectedText) ? expectedText : [expectedText];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getDictationStatusText(page);
    if (expectedTexts.some((candidate) => text.includes(candidate))) return text;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Timed out waiting for dictation status "${expectedTexts.join(" or ")}". Last: "${await getDictationStatusText(page)}"`
  );
}

async function waitForDictationStatusClear(page, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await getDictationStatusText(page);
    if (!text || text.includes("No speech detected") || text.includes("No speech could be recognized")) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for dictation status clear. Last: "${await getDictationStatusText(page)}"`);
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  try {
    fs.unlinkSync(mockProviderSettingsPath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  cdpPort = await getFreePort();

  const electronBin =
    process.platform === "win32"
      ? path.join(rootDir, "node_modules", "electron", "dist", "electron.exe")
      : process.platform === "darwin"
        ? path.join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
        : path.join(rootDir, "node_modules", "electron", "dist", "electron");
  const electronEnv = {
    ...process.env,
    LILTO_E2E_MOCK: "1",
    LILTO_E2E_TURN_DELAY_MS: "6000",
    LILTO_PROVIDER_SETTINGS_PATH: mockProviderSettingsPath,
    HTTP_PROXY: "",
    http_proxy: "",
    HTTPS_PROXY: "",
    https_proxy: "",
    NO_PROXY: "",
    no_proxy: ""
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-electron-e2e-"));
  const electron = spawn(electronBin, [".", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`], {
    cwd: rootDir,
    shell: shouldUseShellForCommand(electronBin),
    env: electronEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let electronLogs = "";
  electron.stdout.on("data", (chunk) => {
    electronLogs += chunk.toString();
  });
  electron.stderr.on("data", (chunk) => {
    electronLogs += chunk.toString();
  });

  let browser;
  let page;
  try {
    console.log("Waiting for CDP...");
    await waitForCdpReady();
    console.log("CDP endpoint ready");

    ({ browser, page } = await connectToElectronApp(cdpPort));
    page.on("pageerror", (error) => console.error(`[renderer pageerror] ${error.stack ?? error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        console.error(`[renderer console.error] ${message.text()}`);
      }
    });
    await waitForAppReady(page);

    const title = await page.title();
    if (!title.includes("Lilt-o")) throw new Error(`Unexpected title: ${title}`);
    console.log(`✓ Title: "${title}"`);

    console.log("✓ lilt-app rendered");
    ({ browser, page } = await verifyLinkNavigation(browser, page, cdpPort));
    await verifyConversationOrder(page);
    await verifyToolGroups(page);

    const initialStatus = await waitForStatus(page, [
      "待機中",
      "認証が必要",
      "Claude 認証が必要",
      "Custom Provider",
      "プロバイダー設定が必要"
    ]);
    console.log(`✓ Initial status: "${initialStatus}"`);
    await verifySidebarActivity(page);

    console.log("Opening settings modal...");
    await clickSettingsButton(page);
    await waitForModalOpen(page);
    console.log("✓ Settings modal opened");

    const ssSettings = path.join(rootDir, "test", "artifacts", "electron-e2e-settings.png");
    await page.screenshot({ path: ssSettings, fullPage: true });
    console.log(`✓ Settings screenshot: ${ssSettings}`);

    const settingsModal = await openChatSettings(page);
    const showToolDetails = settingsModal.locator("#show-tool-execution-details");
    if (await showToolDetails.isChecked()) {
      throw new Error("Tool execution details should be hidden by default");
    }
    await settingsModal.locator(".settings-menu-item").nth(0).click();
    console.log("✓ Tool execution details are hidden by default in Chat settings");

    await switchToCustomProvider(page);
    await setSettingsInputValue(page, "custom-provider-name", "Proxy E2E Provider");
    await setSettingsInputValue(page, "custom-base-url", "http://127.0.0.1:11434/v1");
    await setSettingsInputValue(page, "custom-api-key", "e2e-dummy-key");
    await setSettingsInputValue(page, "custom-model-id", "qwen2.5:0.5b");
    await setSettingsCheckboxValue(page, "use-proxy", false);
    await clickSaveProviderSettingsButton(page);
    await waitForCustomSaveStatus(page, "設定を保存しました。");
    console.log("✓ Custom Provider saved for mocked chat");

    await clickSettingsClose(page);
    await waitForModalClose(page);
    console.log("✓ Settings modal closed");

    await waitForSendEnabled(page);
    const statusAfterSwitch = await getStatusText(page);
    console.log(`✓ Status after provider switch: "${statusAfterSwitch}"`);

    await setAppSendingState(page, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await isNewSessionDisabled(page)) {
      throw new Error("New session button should be enabled while another conversation runs");
    }
    await setAppSendingState(page, false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await isNewSessionDisabled(page)) {
      throw new Error("New session button should be enabled when app isSending=false");
    }
    console.log("✓ New session button remains enabled during a run");

    await holdComposerDictation(page);
    await waitForDictationStatus(page, ["音声入力中...", "録音中...", "Listening..."]);
    await releaseComposerDictation(page);
    await waitForDictationStatusClear(page);
    console.log("✓ Dictation button toggles active status only while pressed");

    const visibilityMessage = "E2E tool visibility check";
    console.log(`Sending mocked prompt: "${visibilityMessage}"...`);
    await fillComposerText(page, visibilityMessage);
    await clickComposerSend(page);

    const expectedFinal = `[E2E_MOCK_FINAL] 要求「${visibilityMessage}」を処理し、複数コマンドを実行して回答しました。`;
    await waitForResponse(page, expectedFinal);
    await page.waitForTimeout(500);
    const visibleConversation = await page.evaluate(() => {
      const app = document.querySelector("lilt-app");
      return app.messages.map(({ role, text }) => ({ role, text }));
    });
    const userMessages = visibleConversation.filter((message) => message.role === "user");
    if (userMessages.length !== 1 || userMessages[0].text !== visibilityMessage) {
      throw new Error(`User prompt was duplicated or changed after completion: ${JSON.stringify(visibleConversation)}`);
    }
    const finalAnswers = visibleConversation.filter((message) => message.role === "assistant" && message.text === expectedFinal);
    if (finalAnswers.length !== 1) {
      throw new Error(`Expected one final answer after progress messages: ${JSON.stringify(visibleConversation)}`);
    }
    console.log("✓ Final response keeps the original prompt once and after progress in turn order");

    const finalMessageState = await page.evaluate((text) => {
      const app = document.querySelector("lilt-app");
      return app.messages
        .filter((message) => message.role === "assistant")
        .find((message) => message.text === text) ?? null;
    }, expectedFinal);
    if (finalMessageState?.pending !== false) {
      throw new Error(`Late tool progress replaced the completed response: ${JSON.stringify(finalMessageState)}`);
    }
    console.log(`✓ Mock final response received: "${expectedFinal}"`);

    const messageList = resolveNamedLocator(page, "app").locator("lilt-message-list");
    const toolConsoles = messageList.locator(".tool-console");
    const hiddenToolDetails = [];
    for (let index = 0; index < await toolConsoles.count(); index += 1) {
      if (await toolConsoles.nth(index).isVisible()) hiddenToolDetails.push(index);
    }
    if (hiddenToolDetails.length > 0) {
      throw new Error("Tool command details should stay collapsed while the Chat setting is off");
    }
    const toolDisclosure = messageList.locator(".tool-disclosure").first();
    if ((await toolDisclosure.locator("summary").getAttribute("aria-label")) !== "コマンド詳細を表示") {
      throw new Error("Collapsed tool details should have a small accessible disclosure icon");
    }
    await toolDisclosure.locator("summary").click();
    await toolDisclosure.locator(".tool-console").first().waitFor({ state: "visible" });
    if (!(await toolDisclosure.locator(".tool-console").allTextContents()).some((text) => text.includes("read_file"))) {
      throw new Error("Clicking the tool icon should reveal command details");
    }
    await toolDisclosure.locator("summary").click();
    if (await toolDisclosure.locator(".tool-console:visible").count() > 0) {
      throw new Error("Clicking the tool icon again should collapse command details");
    }

    await clickSettingsButton(page);
    await waitForModalOpen(page);
    const chatSettings = await openChatSettings(page);
    await chatSettings.locator("#show-tool-execution-details").check();
    await chatSettings.getByRole("button", { name: "Chat 設定を保存" }).click();
    await chatSettings.getByText("Chat 設定を保存しました。", { exact: true }).waitFor({ state: "visible" });
    await chatSettings.locator("#show-tool-execution-details").waitFor({ state: "attached" });
    await chatSettings.locator("#show-tool-execution-details").evaluate((element) => {
      if (!element.checked) throw new Error("Tool execution details setting was not retained after save");
    });
    await toolConsoles.first().waitFor({ state: "visible" });
    if (!(await toolConsoles.allTextContents()).some((text) => text.includes("read_file"))) {
      throw new Error("Enabling tool details should reveal the command passed to the tool");
    }
    await clickSettingsClose(page);
    await waitForModalClose(page);
    console.log("✓ Chat setting reveals and persists tool command details");

    const schedulerMessage = "3分たちました。";
    const schedulerFollowUp = "alpha.co.jp を開きます";
    await injectSchedulerNotification(page, schedulerMessage, schedulerFollowUp);
    await waitForResponse(page, schedulerMessage);
    await waitForResponse(page, `続きの処理: ${schedulerFollowUp}`);
    const schedulerFinal = "[E2E_MOCK_FINAL] 要求「以下はこの会話で発火した scheduler 通知です。";
    await waitForResponse(page, schedulerFinal);
    console.log(`✓ Scheduler notification + follow-up rendered: "${schedulerMessage}" / "${schedulerFollowUp}"`);

    const finalStatus = await waitForStatus(page, ["待機中"]);
    console.log(`✓ Final status: "${finalStatus}"`);

    const countBeforeReset = await getMessageCount(page);
    if (countBeforeReset < 4) throw new Error(`Unexpected message count before reset: ${countBeforeReset}`);
    await clickNewSessionButton(page);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const countAfterReset = await getMessageCount(page);
    if (countAfterReset !== 0) throw new Error(`Expected cleared messages after new session, got: ${countAfterReset}`);
    if (await isNewSessionDisabled(page)) throw new Error("New session button should be enabled after sending");
    console.log("✓ New session reset cleared conversation");
    await verifyConversationSteering(page);
    await verifyComposerDrafts(page);
    await verifyParallelConversations(page);

    await page.evaluate(() => {
      const app = document.querySelector("lilt-app");
      app.updateState = { status: "available", currentVersion: "0.1.4", targetVersion: "0.1.5", source: "startup", revision: 100 };
      app.updateDialogOpen = true;
    });
    const updateDialog = page.locator(".update-dialog");
    await updateDialog.waitFor({ state: "visible" });
    await updateDialog.getByText("Lilt-o 0.1.5 を利用できます。", { exact: true }).waitFor();
    await updateDialog.getByRole("button", { name: "更新をダウンロード" }).waitFor();
    const focusedUpdateControl = await page.evaluate(() => document.querySelector("lilt-app").shadowRoot.activeElement?.textContent?.trim());
    if (focusedUpdateControl !== "更新をダウンロード") throw new Error("Update dialog should focus its primary action");
    await page.keyboard.press("Escape");
    await updateDialog.waitFor({ state: "hidden" });
    const restoredFocus = await page.evaluate(() => document.querySelector("lilt-app").shadowRoot.activeElement?.localName);
    if (restoredFocus !== "lilt-composer") throw new Error("Closing update dialog should restore composer focus");
    await page.evaluate(() => { document.querySelector("lilt-app").updateDialogOpen = true; });
    await updateDialog.waitFor({ state: "visible" });
    await page.evaluate(() => {
      const app = document.querySelector("lilt-app");
      app.updateState = { status: "downloaded", currentVersion: "0.1.4", targetVersion: "0.1.5", revision: 101 };
    });
    const draftInput = page.locator("lilt-composer").locator("textarea");
    await draftInput.fill("更新前に失わない入力内容");
    await updateDialog.getByRole("button", { name: "再起動してインストール" }).click();
    await updateDialog.waitFor({ state: "visible" });
    if (await draftInput.inputValue() !== "更新前に失わない入力内容") {
      throw new Error("Update install should preserve the saved unsent draft");
    }
    await draftInput.fill("");
    await updateDialog.getByRole("button", { name: "後で" }).click();
    await updateDialog.waitFor({ state: "hidden" });
    console.log("✓ Update notice renders and install attempt preserves the saved unsent draft");

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✓ Final screenshot: ${screenshotPath}`);

    const messages = await getMessagesText(page);
    console.log("\nE2E success!");
    console.log("Conversation:");
    messages.split("\n").forEach((message) => {
      if (message) console.log(`  - ${message}`);
    });
  } finally {
    await browser?.close().catch(() => {});

    electron.kill("SIGTERM");
    await new Promise((resolve) => {
      electron.once("exit", () => resolve());
      setTimeout(() => resolve(), 3000);
    });
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (electronLogs.trim()) {
      console.log("Electron logs:");
      console.log(electronLogs);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
