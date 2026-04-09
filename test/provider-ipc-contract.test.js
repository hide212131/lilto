const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("preload exposes provider and dictation IPC methods", () => {
  const content = fs.readFileSync("src/preload.ts", "utf8");
  assert.match(content, /getProviderSettings:\s*async \(\) => ipcRenderer\.invoke\("providers:getSettings"\)/);
  assert.match(content, /getHeartbeatStatus:\s*async \(\): Promise<HeartbeatAssistantStatus> => ipcRenderer\.invoke\("heartbeat:getStatus"\)/);
  assert.match(content, /saveProviderSettings:\s*async \(settings: unknown\) => ipcRenderer\.invoke\("providers:saveSettings", settings\)/);
  assert.match(content, /getAgentsFile:\s*async \(\) => ipcRenderer\.invoke\("app:getAgentsFile"\)/);
  assert.match(content, /openAgentsFile:\s*async \(\) => ipcRenderer\.invoke\("app:openAgentsFile"\)/);
  assert.match(content, /setupWindowsSandbox:\s*async \(payload: unknown\) => ipcRenderer\.invoke\("windowsSandbox:setup", payload\)/);
  assert.match(content, /transcribeAudio:\s*async \(audioData: Uint8Array\): Promise<AudioTranscriptionResult> =>/);
  assert.match(content, /ipcRenderer\.invoke\("audio:transcribe", \{ audioData \}\)/);
  assert.match(content, /startNativeDictation:\s*async \(\) => ipcRenderer\.invoke\("audio:startNativeDictation"\)/);
  assert.match(content, /finishNativeDictation:\s*async \(\): Promise<AudioTranscriptionResult> => ipcRenderer\.invoke\("audio:finishNativeDictation"\)/);
  assert.match(content, /cancelNativeDictation:\s*async \(\) => ipcRenderer\.invoke\("audio:cancelNativeDictation"\)/);
  assert.match(content, /startClaudeOauth:\s*async \(\) => ipcRenderer\.invoke\("auth:startClaudeOauth"\)/);
  assert.match(content, /listModels:\s*async \(payload: unknown\) => ipcRenderer\.invoke\("models:list", payload\)/);
});

test("ipc registers openai-codex auth and dictation handlers", () => {
  const content = fs.readFileSync("src/main/ipc.ts", "utf8");
  assert.match(content, /authService\.startOAuth\("openai-codex"\)/);
  assert.match(content, /ipcMain\.handle\("app:getAgentsFile"/);
  assert.match(content, /ipcMain\.handle\("app:openAgentsFile"/);
  assert.match(content, /shell\.openPath\(agentsFilePath\)/);
  assert.match(content, /ipcMain\.handle\("heartbeat:getStatus"/);
  assert.match(content, /ipcMain\.handle\("models:list"/);
  assert.match(content, /ipcMain\.handle\("windowsSandbox:setup"/);
  assert.match(content, /ipcMain\.handle\("audio:transcribe"/);
  assert.match(content, /ipcMain\.handle\("audio:startNativeDictation"/);
  assert.match(content, /ipcMain\.handle\("audio:finishNativeDictation"/);
  assert.match(content, /ipcMain\.handle\("audio:cancelNativeDictation"/);
  assert.match(content, /speechTranscriptionService\.transcribeWav\(audioData\)/);
  assert.match(content, /speechTranscriptionService\.startNativeDictation\(\)/);
  assert.match(content, /speechTranscriptionService\.finishNativeDictation\(\)/);
  assert.match(content, /agentRuntime\.refreshProviderSettings\(\);/);
});
