const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readIpcSource } = require("./helpers/read-ipc-source");

const preloadContent = fs.readFileSync("src/preload.ts", "utf8");
const ipcContent = readIpcSource();
const ipcContractContent = fs.readFileSync("src/main/ipc-contract.ts", "utf8");

const EXPECTED_HANDLE_CHANNELS = [
  "agent:submitPrompt",
  "agent:steerPrompt",
  "agent:abort",
  "conversations:list",
  "conversations:read",
  "conversations:create",
  "conversations:rename",
  "conversations:archive",
  "auth:getState",
  "auth:startClaudeOauth",
  "auth:submitCode",
  "providers:getSettings",
  "heartbeat:getStatus",
  "models:list",
  "providers:saveSettings",
  "scheduler:list",
  "scheduler:delete",
  "scheduler:showNotification",
  "windowsSandbox:setup",
  "audio:transcribe",
  "audio:startNativeDictation",
  "audio:finishNativeDictation",
  "audio:cancelNativeDictation",
  "app:getAgentsFile",
  "app:openAgentsFile",
  "app:openExternal",
  "skills:list",
  "skills:install",
  "skills:uninstall",
  "skills:checkUpdates",
  "plugins:list",
  "plugins:read",
  "plugins:install",
  "plugins:uninstall",
  "app-update:get-state",
  "app-update:check",
  "app-update:download",
  "app-update:install"
].sort();

function extractMatches(content, pattern) {
  return [...content.matchAll(pattern)].map((match) => match[1]).sort();
}

test("main ipc と preload invoke は同じ 38 チャネルを公開する", () => {
  const mainChannels = extractMatches(ipcContent, /ipcMain\.handle\("([^"]+)"/g);
  const preloadChannels = [...new Set(extractMatches(preloadContent, /ipcRenderer\.invoke\("([^"]+)"/g))].sort();

  assert.equal(mainChannels.length, 38);
  assert.deepEqual(mainChannels, EXPECTED_HANDLE_CHANNELS);
  assert.deepEqual(preloadChannels, EXPECTED_HANDLE_CHANNELS);
});

test("agent と conversation IPC の payload 契約を固定する", () => {
  assert.match(
    preloadContent,
    /submitPrompt: async \(\s*text: string,\s*conversationId\?: string \| null,\s*backendSessionId\?: string \| null,\s*options\?: \{ silent\?: boolean; freshContext\?: boolean \}\s*\)\s*=>\s*ipcRenderer\.invoke\("agent:submitPrompt", \{\s*text,\s*conversationId,\s*backendSessionId,\s*silent: options\?\.silent === true,\s*freshContext: options\?\.freshContext === true\s*\}\)/s
  );
  assert.match(ipcContractContent, /export type PromptPayload = \{/);
  assert.match(ipcContractContent, /conversationId\?: string \| null;/);
  assert.match(ipcContractContent, /backendSessionId\?: string \| null;/);
  assert.match(ipcContractContent, /silent\?: boolean;/);
  assert.match(ipcContractContent, /freshContext\?: boolean;/);
  assert.match(ipcContractContent, /message: "conversationId の形式が不正です"/);
  assert.match(ipcContractContent, /message: "backendSessionId の形式が不正です"/);
  assert.match(ipcContractContent, /message: "silent の形式が不正です"/);
  assert.match(ipcContractContent, /message: "freshContext の形式が不正です"/);

  assert.match(preloadContent, /readConversation: async \(conversationId: string\) => ipcRenderer\.invoke\("conversations:read", \{ conversationId \}\)/);
  assert.match(preloadContent, /createConversation: async \(title\?: string\) => ipcRenderer\.invoke\("conversations:create", \{ title \}\)/);
  assert.match(preloadContent, /renameConversation: async \(conversationId: string, title: string\) =>\s*ipcRenderer\.invoke\("conversations:rename", \{ conversationId, title \}\)/);
  assert.match(preloadContent, /archiveConversation: async \(conversationId: string\) =>\s*ipcRenderer\.invoke\("conversations:archive", \{ conversationId \}\)/);
  assert.match(ipcContent, /ipcMain\.handle\("conversations:read", async \(_event, payload: unknown\) => \{/);
  assert.match(ipcContent, /message: "conversationId は必須です"/);
  assert.match(ipcContent, /message: "conversationId と title は必須です"/);
});

test("provider と auth 系 IPC の payload 契約を固定する", () => {
  assert.match(preloadContent, /getAuthState: async \(\) => ipcRenderer\.invoke\("auth:getState"\)/);
  assert.match(preloadContent, /startClaudeOauth: async \(\) => ipcRenderer\.invoke\("auth:startClaudeOauth"\)/);
  assert.match(preloadContent, /submitAuthCode: async \(code: string\) => ipcRenderer\.invoke\("auth:submitCode", \{ code \}\)/);
  assert.match(preloadContent, /listModels: async \(payload: unknown\) => ipcRenderer\.invoke\("models:list", payload\)/);
  assert.match(preloadContent, /getProviderSettings: async \(\) => ipcRenderer\.invoke\("providers:getSettings"\)/);
  assert.match(preloadContent, /saveProviderSettings: async \(settings: unknown\) => ipcRenderer\.invoke\("providers:saveSettings", settings\)/);
  assert.match(ipcContent, /authService\.startOAuth\("openai-codex"\)/);
  assert.match(ipcContent, /message: "code は必須です"/);
  assert.match(ipcContent, /return providerSettingsService\.getState\(\);/);
  assert.match(ipcContent, /return heartbeatAssistant\.getStatus\(\);/);
  assert.match(ipcContent, /return await modelCatalogService\.listCustomProviderModels\(customProvider, networkProxy\);/);
  assert.match(ipcContent, /return await modelCatalogService\.listOauthModels\(oauthProvider, networkProxy\);/);
});

test("scheduler・sandbox・audio IPC の payload と return 契約を固定する", () => {
  assert.match(preloadContent, /listSchedules: async \(\): Promise<\s*\| \{ ok: true; schedules: SchedulerScheduleSummary\[\] \}\s*\| \{ ok: false; error: \{ code: string; message: string \} \}\s*> => ipcRenderer\.invoke\("scheduler:list"\)/s);
  assert.match(preloadContent, /deleteSchedule: async \(id: string\): Promise<\s*\| \{ ok: true \}\s*\| \{ ok: false; error: \{ code: string; message: string \} \}\s*> => ipcRenderer\.invoke\("scheduler:delete", \{ id \}\)/s);
  assert.match(preloadContent, /showSchedulerNotification: async \(message: string, conversationId\?: string \| null\): Promise<\s*\| \{ ok: true \}\s*\| \{ ok: false; error: \{ code: string; message: string \} \}\s*> => ipcRenderer\.invoke\("scheduler:showNotification", \{ message, conversationId \}\)/s);
  assert.match(preloadContent, /setupWindowsSandbox: async \(payload: unknown\) => ipcRenderer\.invoke\("windowsSandbox:setup", payload\)/);
  assert.match(preloadContent, /transcribeAudio: async \(audioData: Uint8Array\): Promise<AudioTranscriptionResult> =>\s*ipcRenderer\.invoke\("audio:transcribe", \{ audioData \}\)/s);
  assert.match(preloadContent, /startNativeDictation: async \(\) => ipcRenderer\.invoke\("audio:startNativeDictation"\)/);
  assert.match(preloadContent, /finishNativeDictation: async \(\): Promise<AudioTranscriptionResult> => ipcRenderer\.invoke\("audio:finishNativeDictation"\)/);
  assert.match(preloadContent, /cancelNativeDictation: async \(\) => ipcRenderer\.invoke\("audio:cancelNativeDictation"\)/);

  assert.match(ipcContent, /message: "id は必須です"/);
  assert.match(ipcContent, /message: "message は必須です"/);
  assert.match(ipcContent, /message: "message は空にできません"/);
  assert.match(ipcContent, /return \{\s*ok: true as const,\s*schedules: schedules\.filter\(/s);
  assert.match(ipcContent, /return \{ ok: false as const, error: \{ code, message \} \};/);
  assert.match(ipcContent, /message: "mode は elevated または unelevated を指定してください。"/);
  assert.match(ipcContent, /audioData\?: unknown/);
  assert.match(ipcContent, /payload as \{ audioData: ArrayBuffer \}/);
  assert.match(ipcContent, /message: "audioData は必須です。"/);
  assert.match(ipcContent, /return await speechTranscriptionService\.transcribeWav\(audioData\);/);
  assert.match(ipcContent, /return \{ ok: true as const \};/);
});

test("app・skills・plugins IPC の payload 契約を固定する", () => {
  assert.match(preloadContent, /getAgentsFile: async \(\) => ipcRenderer\.invoke\("app:getAgentsFile"\)/);
  assert.match(preloadContent, /openAgentsFile: async \(\) => ipcRenderer\.invoke\("app:openAgentsFile"\)/);
  assert.match(preloadContent, /openExternalUrl: async \(url: string\) => ipcRenderer\.invoke\("app:openExternal", \{ url \}\)/);
  assert.match(preloadContent, /listSkills: async \(\) => ipcRenderer\.invoke\("skills:list"\)/);
  assert.match(preloadContent, /installSkill: async \(url: string\) => ipcRenderer\.invoke\("skills:install", \{ url \}\)/);
  assert.match(preloadContent, /installSkillFromSource: async \(source: string\) => ipcRenderer\.invoke\("skills:install", \{ source \}\)/);
  assert.match(preloadContent, /uninstallSkill: async \(filePath: string\) => ipcRenderer\.invoke\("skills:uninstall", \{ filePath \}\)/);
  assert.match(preloadContent, /checkSkillUpdates: async \(\) => ipcRenderer\.invoke\("skills:checkUpdates"\)/);
  assert.match(preloadContent, /listPlugins: async \(payload\?: \{ forceRemoteSync\?: boolean \}\) => ipcRenderer\.invoke\("plugins:list", payload \?\? \{\}\)/);
  assert.match(preloadContent, /readPlugin: async \(payload: \{ marketplacePath: string; pluginName: string \}\) =>\s*ipcRenderer\.invoke\("plugins:read", payload\)/s);
  assert.match(preloadContent, /installPlugin: async \(payload: \{ marketplacePath: string; pluginName: string; sourceKind: "official-curated" \| "bundled" \}\) =>\s*ipcRenderer\.invoke\("plugins:install", payload\)/s);
  assert.match(preloadContent, /uninstallPlugin: async \(payload: \{ pluginId: string; sourceKind\?: "official-curated" \| "bundled" \}\) =>\s*ipcRenderer\.invoke\("plugins:uninstall", payload\)/s);

  assert.match(ipcContent, /exists: fs\.existsSync\(agentsFilePath\)/);
  assert.match(ipcContent, /message: "url は必須です"/);
  assert.match(ipcContent, /message: "url の形式が不正です"/);
  assert.match(ipcContent, /message: "http\/https のみサポートします"/);
  assert.match(ipcContent, /return \{ ok: false, error: "payload が必須です" \};/);
  assert.match(ipcContent, /return \{ ok: false, error: "source または url は必須です" \};/);
  assert.match(ipcContent, /return \{ ok: false, error: "filePath は必須です" \};/);
  assert.match(ipcContent, /message: "marketplacePath, pluginName は必須です"/);
  assert.match(ipcContent, /message: "marketplacePath, pluginName, sourceKind は必須です"/);
  assert.match(ipcContent, /message: "pluginId は必須です"/);
  assert.match(ipcContent, /refreshAgentSkills\(\)/);
  assert.match(ipcContent, /refreshAgentPlugins\(\)/);
});
