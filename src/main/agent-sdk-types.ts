export type CodexConfig = Record<string, unknown>;

export type SessionThreadOptions = {
  sandboxMode: "danger-full-access" | "workspace-write";
  config?: CodexConfig;
};

export type AgentError = {
  code: string;
  message: string;
  details: string | null;
  retryable: boolean;
};

type AgentSuccess = { ok: true; text: string };
type AgentFailure = { ok: false; error: AgentError };
export type AgentResult = AgentSuccess | AgentFailure;

export type RuntimeModel = {
  id: string;
  baseUrl?: string;
};

export type Thread = {
  id: string | null;
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
};

export type ThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "error"; message: string }
  | { type: "item.started" | "item.updated" | "item.completed"; item: ThreadItem }
  | { type: string };

export type ThreadItem =
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "command_execution"; command: string; status: "in_progress" | "completed" | "failed" }
  | { id: string; type: "mcp_tool_call"; tool: string; server: string; arguments: unknown; status: "in_progress" | "completed" | "failed" }
  | { id: string; type: "error"; message?: string; text?: string; error?: { message?: string; code?: string } }
  | { id: string; type: string };