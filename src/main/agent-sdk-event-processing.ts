import type { Logger } from "./logger";
import type { AgentLoopEvent } from "../shared/agent-loop";
import type { ThreadEvent, ThreadItem } from "./agent-sdk-types";

const EVENT_LOG_PREVIEW_LIMIT = 160;

function previewForLog(text: string): string {
  if (!text.trim()) {
    return "";
  }
  return text.length > EVENT_LOG_PREVIEW_LIMIT ? `${text.slice(0, EVENT_LOG_PREVIEW_LIMIT)}...` : text;
}

export function summarizeThreadItem(item: ThreadItem): Record<string, unknown> {
  const typedItem = item as any;
  const payload: Record<string, unknown> = { type: item.type, id: item.id };
  if (item.type === "reasoning" || item.type === "agent_message") {
    payload.preview = previewForLog(typedItem.text ?? "");
  } else if (item.type === "command_execution") {
    payload.command = typedItem.command;
    payload.status = typedItem.status;
  } else if (item.type === "mcp_tool_call") {
    payload.server = typedItem.server;
    payload.tool = typedItem.tool;
    payload.status = typedItem.status;
  } else if (item.type === "error") {
    payload.message = typedItem.message ?? typedItem.error?.message ?? previewForLog(typedItem.text ?? "");
    payload.code = typedItem.error?.code;
  }
  return payload;
}

export function extractThreadItemErrorMessage(item: ThreadItem): string {
  const typedItem = item as any;
  if (typeof typedItem.message === "string" && typedItem.message.trim()) {
    return typedItem.message.trim();
  }
  if (typeof typedItem.error?.message === "string" && typedItem.error.message.trim()) {
    return typedItem.error.message.trim();
  }
  if (typeof typedItem.text === "string" && typedItem.text.trim()) {
    return typedItem.text.trim();
  }
  return "Codex runtime returned an error item.";
}

function buildReasoningText(item: Record<string, unknown>): string {
  if (typeof item.text === "string") {
    return item.text;
  }

  const summary = Array.isArray(item.summary)
    ? item.summary
        .map((entry) => (entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string")
          ? (entry as { text: string }).text
          : "")
        .filter(Boolean)
        .join("\n")
    : "";
  if (summary) {
    return summary;
  }

  const content = Array.isArray(item.content)
    ? item.content
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return "";
          }
          if (typeof (entry as { text?: unknown }).text === "string") {
            return (entry as { text: string }).text;
          }
          if (typeof (entry as { summary?: unknown }).summary === "string") {
            return (entry as { summary: string }).summary;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
  return content;
}

function normalizeAppServerItemStatus(status: unknown): "in_progress" | "completed" | "failed" {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed" || status === "declined") {
    return "failed";
  }
  return "in_progress";
}

function normalizeCommandPreview(command: unknown): string {
  if (typeof command === "string") {
    return command;
  }
  if (Array.isArray(command)) {
    return command.map((entry) => String(entry)).join(" ");
  }
  return "";
}

export function translateAppServerItem(item: unknown): ThreadItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "unknown-item";
  switch (record.type) {
    case "agentMessage":
      return {
        id,
        type: "agent_message",
        text: typeof record.text === "string" ? record.text : ""
      };
    case "reasoning":
      return {
        id,
        type: "reasoning",
        text: buildReasoningText(record)
      };
    case "commandExecution":
      return {
        id,
        type: "command_execution",
        command: normalizeCommandPreview(record.command),
        status: normalizeAppServerItemStatus(record.status)
      };
    case "mcpToolCall":
      return {
        id,
        type: "mcp_tool_call",
        tool: typeof record.tool === "string" ? record.tool : "unknown",
        server: typeof record.server === "string" ? record.server : "unknown",
        arguments: record.arguments,
        status: normalizeAppServerItemStatus(record.status)
      };
    case "error":
      return {
        id,
        type: "error",
        message:
          typeof record.message === "string"
            ? record.message
            : record.error && typeof record.error === "object" && typeof (record.error as { message?: unknown }).message === "string"
              ? (record.error as { message: string }).message
              : undefined,
        error: record.error && typeof record.error === "object"
          ? record.error as { message?: string; code?: string }
          : undefined
      };
    default:
      return {
        id,
        type: typeof record.type === "string" ? record.type : "unknown"
      };
  }
}

export type ThreadProcessingState = {
  requestId: string;
  textByItemId: Map<string, string>;
  textOutput: string;
  thinkingActive: Set<string>;
};

export type ThreadProcessingHooks = {
  requestId: string;
  conversationId?: string;
  freshContext?: boolean;
  onLoopEvent?: (event: AgentLoopEvent) => void;
};

export function processThreadEvent(
  event: ThreadEvent,
  state: ThreadProcessingState,
  hooks: ThreadProcessingHooks | undefined,
  logger: Logger,
  conversationThreads: Map<string, string>
): { textOutput: string; fatalError?: string } {
  if (event.type === "thread.started") {
    const started = event as { thread_id: string };
    if (hooks?.conversationId && !hooks.freshContext) {
      conversationThreads.set(hooks.conversationId, started.thread_id);
    }
    hooks?.onLoopEvent?.({
      type: "session_bound",
      requestId: state.requestId,
      conversationId: hooks?.conversationId,
      agentSessionId: started.thread_id
    });
    return { textOutput: state.textOutput };
  }

  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
    return { textOutput: state.textOutput };
  }

  const item = (event as { item: ThreadItem }).item;
  const typedItem = item as any;
  logger.info("agent_item_event", summarizeThreadItem(item));

  if (item.type === "reasoning") {
    const previous = state.textByItemId.get(item.id) ?? "";
    const next = typedItem.text ?? "";
    if (!state.thinkingActive.has(item.id)) {
      state.thinkingActive.add(item.id);
      hooks?.onLoopEvent?.({ type: "thinking_start", requestId: state.requestId });
    }
    const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
    if (delta) {
      hooks?.onLoopEvent?.({ type: "thinking_delta", requestId: state.requestId, delta });
    }
    state.textByItemId.set(item.id, next);
    if (event.type === "item.completed") {
      state.thinkingActive.delete(item.id);
      hooks?.onLoopEvent?.({ type: "thinking_end", requestId: state.requestId });
    }
    return { textOutput: state.textOutput };
  }

  if (item.type === "command_execution") {
    if (event.type === "item.started") {
      hooks?.onLoopEvent?.({
        type: "tool_execution_start",
        requestId: state.requestId,
        toolCallId: item.id,
        toolName: "shell",
        args: { command: typedItem.command }
      });
    }
    if (event.type === "item.completed") {
      hooks?.onLoopEvent?.({
        type: "tool_execution_end",
        requestId: state.requestId,
        toolCallId: item.id,
        toolName: "shell",
        isError: typedItem.status === "failed"
      });
    }
    return { textOutput: state.textOutput };
  }

  if (item.type === "mcp_tool_call") {
    if (event.type === "item.started") {
      hooks?.onLoopEvent?.({
        type: "tool_execution_start",
        requestId: state.requestId,
        toolCallId: item.id,
        toolName: typedItem.tool,
        args: typedItem.arguments
      });
    }
    if (event.type === "item.completed") {
      hooks?.onLoopEvent?.({
        type: "tool_execution_end",
        requestId: state.requestId,
        toolCallId: item.id,
        toolName: typedItem.tool,
        isError: typedItem.status === "failed"
      });
    }
    return { textOutput: state.textOutput };
  }

  if (item.type === "agent_message") {
    const previous = state.textByItemId.get(item.id) ?? "";
    const next = typedItem.text ?? "";
    const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
    if (delta) {
      hooks?.onLoopEvent?.({ type: "text_delta", requestId: state.requestId, delta });
    }
    state.textByItemId.set(item.id, next);
    return { textOutput: next || state.textOutput };
  }

  if (item.type === "error" && event.type === "item.completed") {
    const message = extractThreadItemErrorMessage(item);
    logger.error("agent_item_error", item);
    return { textOutput: state.textOutput, fatalError: message };
  }

  return { textOutput: state.textOutput };
}