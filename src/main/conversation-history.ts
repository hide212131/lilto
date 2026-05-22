import path from "node:path";

import { CodexAppServerClient } from "./codex-app-server-client";
import { resolveCodexProcessEnvironment, WINDOWS_POWERSHELL_PATHS } from "./codex-environment";
import { resolvePackagedCodexBinary } from "./app-paths";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  text: string;
};

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  backendSessionId: string;
  messages: ConversationMessage[];
};

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Date.now();
  }
  return value < 10_000_000_000 ? value * 1000 : value;
}

function fallbackTitleFromThread(thread: Record<string, unknown>): string {
  if (typeof thread.name === "string" && thread.name.trim()) {
    return thread.name.trim();
  }
  if (typeof thread.preview === "string" && thread.preview.trim()) {
    return thread.preview.trim().slice(0, 40);
  }
  return "会話";
}

function extractUserMessageText(item: Record<string, unknown>): string {
  if (!Array.isArray(item.content)) {
    return "";
  }
  return item.content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      if (typeof (entry as { text?: unknown }).text === "string") {
        return (entry as { text: string }).text;
      }
      if (typeof (entry as { url?: unknown }).url === "string") {
        return (entry as { url: string }).url;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseMessagesFromTurns(turns: unknown): ConversationMessage[] {
  if (!Array.isArray(turns)) {
    return [];
  }

  const messages: ConversationMessage[] = [];
  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }
    const turnRecord = turn as Record<string, unknown>;
    const items = Array.isArray(turnRecord.items) ? turnRecord.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : `msg-${messages.length + 1}`;
      switch (record.type) {
        case "userMessage": {
          const text = extractUserMessageText(record);
          if (text) {
            messages.push({ id, role: "user", text });
          }
          break;
        }
        case "agentMessage": {
          const text = typeof record.text === "string" ? record.text : "";
          if (text) {
            messages.push({ id, role: "assistant", text });
          }
          break;
        }
        case "error": {
          const text = typeof record.message === "string"
            ? record.message
            : record.error && typeof record.error === "object" && typeof (record.error as { message?: unknown }).message === "string"
              ? (record.error as { message: string }).message
              : "";
          if (text) {
            messages.push({ id, role: "error", text });
          }
          break;
        }
        default:
          break;
      }
    }

    if (turnRecord.error && typeof turnRecord.error === "object" && typeof (turnRecord.error as { message?: unknown }).message === "string") {
      messages.push({
        id: typeof turnRecord.id === "string" ? `${turnRecord.id}-error` : `turn-error-${messages.length + 1}`,
        role: "error",
        text: (turnRecord.error as { message: string }).message
      });
    }
  }

  return messages;
}

export class ConversationHistoryService {
  constructor(
    private readonly options: {
      codexHomeDir?: string;
      homeDir?: string;
      workspaceDir: string;
    }
  ) {}

  async listConversations(): Promise<ConversationRecord[]> {
    const client = await this.createClient();
    try {
      const result = await client.request<{ data?: Array<Record<string, unknown>> }>("thread/list", {
        sourceKinds: ["vscode", "appServer"],
        archived: false,
        sortKey: "updated_at",
        cwd: this.options.workspaceDir
      });
      const data = Array.isArray(result?.data) ? result.data : [];
      return data.map((thread) => ({
        id: typeof thread.id === "string" ? thread.id : "",
        title: fallbackTitleFromThread(thread),
        createdAt: normalizeTimestamp(thread.createdAt),
        updatedAt: normalizeTimestamp(thread.updatedAt ?? thread.createdAt),
        backendSessionId: typeof thread.id === "string" ? thread.id : "",
        messages: []
      })).filter((thread) => thread.id);
    } finally {
      client.close();
    }
  }

  async readConversation(conversationId: string): Promise<ConversationRecord | null> {
    const client = await this.createClient();
    try {
      const result = await client.request<{ thread?: Record<string, unknown> }>("thread/read", {
        threadId: conversationId,
        includeTurns: true
      });
      const thread = result?.thread;
      if (!thread || typeof thread !== "object") {
        return null;
      }
      return {
        id: typeof thread.id === "string" ? thread.id : conversationId,
        title: fallbackTitleFromThread(thread),
        createdAt: normalizeTimestamp(thread.createdAt),
        updatedAt: normalizeTimestamp(thread.updatedAt ?? thread.createdAt),
        backendSessionId: typeof thread.id === "string" ? thread.id : conversationId,
        messages: parseMessagesFromTurns(thread.turns)
      };
    } finally {
      client.close();
    }
  }

  async createConversation(title?: string): Promise<ConversationRecord> {
    const client = await this.createClient();
    try {
      const result = await client.request<{ thread?: Record<string, unknown> }>("thread/start", {
        cwd: this.options.workspaceDir,
        serviceName: "lilto"
      });
      const thread = result?.thread;
      const threadId = typeof thread?.id === "string" ? thread.id : null;
      if (!threadId) {
        throw new Error("codex app-server did not return a thread id");
      }
      if (title?.trim()) {
        await client.request("thread/name/set", {
          threadId,
          name: title.trim()
        });
      }
      return {
        id: threadId,
        title: title?.trim() || fallbackTitleFromThread(thread ?? {}),
        createdAt: normalizeTimestamp(thread?.createdAt),
        updatedAt: normalizeTimestamp(thread?.updatedAt ?? thread?.createdAt),
        backendSessionId: threadId,
        messages: []
      };
    } finally {
      client.close();
    }
  }

  async renameConversation(conversationId: string, newTitle: string): Promise<void> {
    const client = await this.createClient();
    try {
      await client.request("thread/name/set", {
        threadId: conversationId,
        name: newTitle.trim()
      });
    } finally {
      client.close();
    }
  }

  async archiveConversation(conversationId: string): Promise<void> {
    const client = await this.createClient();
    try {
      await client.request("thread/archive", {
        threadId: conversationId
      });
    } finally {
      client.close();
    }
  }

  private async createClient(): Promise<CodexAppServerClient> {
    const packagedCodex = resolvePackagedCodexBinary();
    const invocationEnv = await resolveCodexProcessEnvironment({
      codexHomeDir: this.options.codexHomeDir,
      prependPathEntries: packagedCodex?.extraPath ? [packagedCodex.extraPath] : undefined,
      appendPathEntries: process.platform === "win32" ? WINDOWS_POWERSHELL_PATHS : undefined
    });
    return new CodexAppServerClient({
      codexHomeDir: this.options.codexHomeDir ?? path.join(this.options.homeDir ?? process.env.HOME ?? process.cwd(), ".codex"),
      codexCommand: packagedCodex?.command,
      invocationEnv
    });
  }
}