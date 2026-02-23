export type AgentRunEndStatus = "completed" | "failed" | "aborted";

export type AgentLoopEvent =
  | { type: "run_start"; requestId: string }
  | { type: "thinking_start"; requestId: string }
  | { type: "thinking_end"; requestId: string }
  | { type: "tool_execution_start"; requestId: string; toolCallId: string; toolName: string; args?: unknown }
  | { type: "tool_execution_end"; requestId: string; toolCallId: string; toolName: string; isError: boolean }
  | { type: "run_end"; requestId: string; status: AgentRunEndStatus; errorMessage?: string };

export type LoopVisualStatus = "idle" | "running" | "completed" | "failed";

export type ActiveTool = {
  toolCallId: string;
  toolName: string;
};

export type LoopState = {
  requestId: string | null;
  status: LoopVisualStatus;
  activeTools: ActiveTool[];
  lastError: string | null;
};

export function createInitialLoopState(): LoopState {
  return {
    requestId: null,
    status: "idle",
    activeTools: [],
    lastError: null
  };
}

function isCurrentRequest(state: LoopState, requestId: string): boolean {
  return state.requestId === null || state.requestId === requestId;
}

export function reduceLoopState(state: LoopState, event: AgentLoopEvent): LoopState {
  switch (event.type) {
    case "run_start":
      return {
        requestId: event.requestId,
        status: "running",
        activeTools: [],
        lastError: null
      };

    case "thinking_start":
    case "thinking_end":
      if (!isCurrentRequest(state, event.requestId)) return state;
      return {
        ...state,
        requestId: event.requestId,
        status: "running"
      };

    case "tool_execution_start": {
      if (!isCurrentRequest(state, event.requestId)) return state;
      const exists = state.activeTools.some((tool) => tool.toolCallId === event.toolCallId);
      const activeTools = exists
        ? state.activeTools
        : [...state.activeTools, { toolCallId: event.toolCallId, toolName: event.toolName }];
      return {
        ...state,
        requestId: event.requestId,
        status: "running",
        activeTools
      };
    }

    case "tool_execution_end": {
      if (!isCurrentRequest(state, event.requestId)) return state;
      const activeTools = state.activeTools.filter((tool) => tool.toolCallId !== event.toolCallId);
      return {
        ...state,
        requestId: event.requestId,
        status: "running",
        activeTools
      };
    }

    case "run_end":
      if (!isCurrentRequest(state, event.requestId)) return state;
      return {
        requestId: event.requestId,
        status: event.status === "completed" ? "completed" : "failed",
        activeTools: [],
        lastError: event.errorMessage ?? null
      };

    default:
      return state;
  }
}
