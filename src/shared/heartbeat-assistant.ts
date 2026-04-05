export const HEARTBEAT_INTERNAL_SCHEDULE_ID = "lilto:heartbeat-assistant";
export const HEARTBEAT_ASSISTANT_SESSION_ID = "heartbeat-assistant";
export const HEARTBEAT_ASSISTANT_SESSION_PREFIX = `${HEARTBEAT_ASSISTANT_SESSION_ID}:`;

export function buildHeartbeatAssistantSessionId(dateKey: string): string {
  return `${HEARTBEAT_ASSISTANT_SESSION_PREFIX}${dateKey}`;
}

export function heartbeatSessionDateKeyFromSessionId(sessionId: string): string | null {
  if (!sessionId.startsWith(HEARTBEAT_ASSISTANT_SESSION_PREFIX)) {
    return null;
  }
  const dateKey = sessionId.slice(HEARTBEAT_ASSISTANT_SESSION_PREFIX.length).trim();
  return dateKey || null;
}

export function isHeartbeatAssistantSessionId(sessionId: string): boolean {
  return sessionId === HEARTBEAT_ASSISTANT_SESSION_ID || sessionId.startsWith(HEARTBEAT_ASSISTANT_SESSION_PREFIX);
}

export function buildHeartbeatAssistantSessionTitle(dateKey: string): string {
  return `Heartbeat assistant ${dateKey}`;
}

export type HeartbeatAssistantStatus = {
  level: "disabled" | "ready" | "missing-file" | "unreadable" | "empty" | "ok" | "finding" | "error";
  message: string;
  lastRunAt: string | null;
  lastFindingAt: string | null;
};