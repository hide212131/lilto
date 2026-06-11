import type { AgentError } from "./agent-sdk-types";

export function standardizeError(
  error: unknown,
  code = "AGENT_EXECUTION_FAILED",
  retryable = true
): AgentError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
      details: error.stack ?? null,
      retryable
    };
  }

  return {
    code,
    message: String(error),
    details: null,
    retryable
  };
}

export function standardizeExecutionError(error: unknown): AgentError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("proxy precheck failed")) {
    return standardizeError(error, "PROXY_CONNECTION_FAILED", true);
  }
  const lowered = message.toLowerCase();
  if (lowered.includes("sandbox setup required") || lowered.includes("setup is missing or out of date")) {
    return standardizeError(error, "WINDOWS_SANDBOX_SETUP_REQUIRED", true);
  }
  if (lowered.includes("restricted read-only access is not yet supported") || lowered.includes("only available on windows")) {
    return standardizeError(error, "WINDOWS_SANDBOX_UNSUPPORTED_MODE", false);
  }
  if (lowered.includes("windows sandbox")) {
    return standardizeError(error, "WINDOWS_SANDBOX_SETUP_FAILED", true);
  }
  return standardizeError(error);
}