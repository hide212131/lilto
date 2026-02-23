import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lilt", {
  submitPrompt: async (text: string) => ipcRenderer.invoke("agent:submitPrompt", { text })
});
