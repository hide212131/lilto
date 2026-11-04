import path from "node:path";
import type { HistoryPageRequest, HistoryPageInfo } from "../shared/conversation-history-window";

import { stripSchedulerPromptGuidance } from "./agent-sdk-config";
import { CodexAppServerClient } from "./codex-app-server-client";
import { resolveCodexProcessEnvironment, WINDOWS_POWERSHELL_PATHS } from "./codex-environment";
import { resolvePackagedCodexBinary } from "./app-paths";
import { readRolloutTimestamps } from "./conversation-rollout-timestamps";

type ConversationMessage = {
  id: string;
  createdAt: number;
  role: "user" | "assistant" | "system" | "error";
  text: string;
};

const AUXILIARY_THREAD_SERVICE_NAME = "lilto-background";
const SCHEDULER_FOLLOW_UP_THREAD_PREFIX = "以下はこの会話で発火した scheduler 通知です。";

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  backendSessionId: string;
  messages: ConversationMessage[];
  historyPage?: HistoryPageInfo;
};

function normalizeTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value < 10_000_000_000 ? value * 1000 : value;
}

function resolveRecordTimestamp(record: Record<string, unknown>, fallback: number): number {
  const candidates = [record.createdAt, record.updatedAt, record.timestamp, record.time];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return normalizeTimestamp(candidate, fallback);
    }
  }
  return fallback;
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

function isAuxiliaryConversationThread(thread: Record<string, unknown>): boolean {
  if (thread.serviceName === AUXILIARY_THREAD_SERVICE_NAME) {
    return true;
  }

  return fallbackTitleFromThread(thread).startsWith(SCHEDULER_FOLLOW_UP_THREAD_PREFIX);
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

function parseMessagesFromTurns(
  turns: unknown,
  fallbackTimestamp: number,
  rolloutTimestamp: (turnId: string, role: string, text: string) => number | undefined
): ConversationMessage[] {
  if (!Array.isArray(turns)) {
    return [];
  }

  const messages: ConversationMessage[] = [];
  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }
    const turnRecord = turn as Record<string, unknown>;
    const turnId = typeof turnRecord.id === "string" ? turnRecord.id : "";
    const turnTimestamp = normalizeTimestamp(
      turnRecord.startedAt, resolveRecordTimestamp(turnRecord, fallbackTimestamp)
    );
    const turnCompletedAt = normalizeTimestamp(turnRecord.completedAt, turnTimestamp);
    const items = Array.isArray(turnRecord.items) ? turnRecord.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : `msg-${messages.length + 1}`;
      const createdAtFor = (role: string, text: string) => resolveRecordTimestamp(
        record, rolloutTimestamp(turnId, role, text)
          ?? (role === "user" || record.phase === "commentary" ? turnTimestamp : turnCompletedAt)
      );
      switch (record.type) {
        case "userMessage": {
          const text = stripSchedulerPromptGuidance(extractUserMessageText(record));
          if (text) {
            messages.push({ id, createdAt: createdAtFor("user", text), role: "user", text });
          }
          break;
        }
        case "agentMessage": {
          const text = typeof record.text === "string" ? record.text : "";
          if (text) {
            messages.push({ id, createdAt: createdAtFor("assistant", text), role: "assistant", text });
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
            messages.push({ id, createdAt: createdAtFor("error", text), role: "error", text });
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
        createdAt: rolloutTimestamp(turnId, "error", (turnRecord.error as { message: string }).message) ?? turnCompletedAt,
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
      const data: Array<Record<string, unknown>> = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await client.request<{
          data?: Array<Record<string, unknown>>;
          nextCursor?: string | null;
        }>("thread/list", {
          sourceKinds: ["vscode", "appServer"],
          archived: false,
          sortKey: "updated_at",
          cwd: this.options.workspaceDir,
          ...(cursor === undefined ? {} : { cursor })
        });
        data.push(...(Array.isArray(result?.data) ? result.data : []));
        cursor = result.nextCursor ?? undefined;
        if (cursor !== undefined) {
          if (seenCursors.has(cursor)) {
            throw new Error("codex app-server returned a repeated thread/list cursor");
          }
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
      return data.map((thread) => ({
        id: typeof thread.id === "string" ? thread.id : "",
        title: fallbackTitleFromThread(thread),
        createdAt: normalizeTimestamp(thread.createdAt),
        updatedAt: normalizeTimestamp(thread.updatedAt ?? thread.createdAt),
        backendSessionId: typeof thread.id === "string" ? thread.id : "",
        messages: []
      })).filter((thread, index) => thread.id && !isAuxiliaryConversationThread(data[index] ?? {}));
    } finally {
      client.close();
    }
  }

  async readConversation(conversationId: string, page: HistoryPageRequest = {}): Promise<ConversationRecord | null> {
    const client = await this.createClient();
    try {
      const result = await client.request<{ thread?: Record<string, unknown> }>("thread/read", {
        threadId: conversationId,
        includeTurns: false
      });
      const thread = result?.thread;
      if (!thread || typeof thread !== "object") {
        return null;
      }
      const threadCreatedAt = normalizeTimestamp(thread.createdAt);
      const direction = page.direction ?? "older";
      const resultPage = await client.request<{
        data: Array<Record<string, unknown>>;
        nextCursor: string | null;
        backwardsCursor: string | null;
      }>("thread/turns/list", {
        threadId: conversationId,
        cursor: page.cursor,
        limit: 20,
        sortDirection: direction === "older" ? "desc" : "asc",
        itemsView: "full"
      });
      const turns = direction === "older" ? [...resultPage.data].reverse() : resultPage.data;
      // Current API timestamps avoid scanning a growing rollout for every page.
      // Legacy producers need the fallback, restricted to the requested turns.
      const needsRollout = turns.some((turn) => typeof turn.startedAt !== "number");
      const rolloutTimestamp = needsRollout
        ? await readRolloutTimestamps(thread.path, new Set(turns.map((turn) => String(turn.id ?? ""))))
        : () => undefined;
      const historyPage: HistoryPageInfo = direction === "older"
        ? { olderCursor: resultPage.nextCursor, newerCursor: page.cursor ? resultPage.backwardsCursor : null }
        : { olderCursor: resultPage.backwardsCursor, newerCursor: resultPage.nextCursor };
      return {
        id: typeof thread.id === "string" ? thread.id : conversationId,
        title: fallbackTitleFromThread(thread),
        createdAt: threadCreatedAt,
        updatedAt: normalizeTimestamp(thread.updatedAt ?? thread.createdAt),
        backendSessionId: typeof thread.id === "string" ? thread.id : conversationId,
        messages: parseMessagesFromTurns(turns, threadCreatedAt, rolloutTimestamp),
        historyPage
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
