import fs from "node:fs";
import path from "node:path";

export const HEARTBEAT_STATE_FILE = "heartbeat_state.json";
export const LEGACY_HEARTBEAT_STATE_FILE = "heartbeat-assistant-state.json";
export const HEARTBEAT_SCHEDULE_TITLE = "Heartbeat assistant patrol";
export const HEARTBEAT_NOTIFICATION_MESSAGE = "heartbeat assistant patrol";
export const HEARTBEAT_TIMEZONE = "Asia/Tokyo";
export const DEFAULT_HEARTBEAT_CHECK_NAME = "patrol";

export type HeartbeatLastSeen = {
  messageIds: string[];
  eventIds: string[];
  taskIds: string[];
};

export type HeartbeatPersistedState = {
  version: 1;
  lastChecks: Record<string, number | null>;
  lastNotified: Record<string, number>;
  lastSeen: HeartbeatLastSeen;
  lastRunAt?: number;
  lastOutcome?: "idle" | "ok" | "finding" | "error" | "empty" | "missing_file" | "unreadable";
  lastError?: string;
  lastFindingText?: string;
  lastFindingKey?: string;
  lastFindingAt?: number;
};

export type ParsedHeartbeatFinding = {
  checkName: string;
  findingKey: string;
  message: string;
};

export function defaultHeartbeatState(): HeartbeatPersistedState {
  return {
    version: 1,
    lastChecks: {},
    lastNotified: {},
    lastSeen: {
      messageIds: [],
      eventIds: [],
      taskIds: []
    }
  };
}

export function buildHeartbeatCronExpr(intervalMinutes: number): string {
  return `0 */${intervalMinutes} * * * *`;
}

export function normalizeHeartbeatResponse(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
}

function heartbeatFingerprint(text: string): string {
  return normalizeHeartbeatResponse(text).toLowerCase();
}

function normalizeHeartbeatText(text: string): string {
  return text.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, "").replace(/\r\n/g, "\n").trim();
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
    : [];
}

function normalizeLastSeen(value: unknown): HeartbeatLastSeen {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    messageIds: normalizeStringArray(record.messageIds),
    eventIds: normalizeStringArray(record.eventIds),
    taskIds: normalizeStringArray(record.taskIds)
  };
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTimestampRecord(value: unknown): Record<string, number | null> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: Record<string, number | null> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (!key.trim()) {
      continue;
    }
    next[key] = rawValue === null ? null : toTimestampMs(rawValue);
  }
  return next;
}

function normalizeLastNotified(value: unknown): Record<string, number> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const timestamp = toTimestampMs(rawValue);
    if (!key.trim() || timestamp === null) {
      continue;
    }
    next[key] = timestamp;
  }
  return next;
}

export function normalizeState(raw: unknown): HeartbeatPersistedState {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lastRunAt = toTimestampMs(record.lastRunAt);
  const legacyLastNotifiedAt = toTimestampMs(record.lastNotifiedAt);
  const lastChecks = normalizeTimestampRecord(record.lastChecks);
  const lastNotified = normalizeLastNotified(record.lastNotified);
  const legacyFindingKey =
    typeof record.lastFindingKey === "string" && record.lastFindingKey.trim()
      ? record.lastFindingKey.trim()
      : typeof record.lastFindingFingerprint === "string" && record.lastFindingFingerprint.trim()
        ? record.lastFindingFingerprint.trim()
        : null;

  if (Object.keys(lastChecks).length === 0 && lastRunAt !== null) {
    lastChecks[DEFAULT_HEARTBEAT_CHECK_NAME] = lastRunAt;
  }
  if (legacyFindingKey && legacyLastNotifiedAt !== null && lastNotified[legacyFindingKey] === undefined) {
    lastNotified[legacyFindingKey] = legacyLastNotifiedAt;
  }

  return {
    version: 1,
    lastChecks,
    lastNotified,
    lastSeen: normalizeLastSeen(record.lastSeen),
    lastRunAt: lastRunAt ?? undefined,
    lastOutcome:
      typeof record.lastOutcome === "string"
        ? (record.lastOutcome as HeartbeatPersistedState["lastOutcome"])
        : undefined,
    lastError: typeof record.lastError === "string" ? record.lastError : undefined,
    lastFindingText: typeof record.lastFindingText === "string" ? record.lastFindingText : undefined,
    lastFindingKey: legacyFindingKey ?? undefined,
    lastFindingAt: toTimestampMs(record.lastFindingAt) ?? legacyLastNotifiedAt ?? undefined
  };
}

export function buildPromptStateSummary(state: HeartbeatPersistedState): string {
  return JSON.stringify(
    {
      lastChecks: state.lastChecks,
      lastNotified: state.lastNotified,
      lastSeen: state.lastSeen
    },
    null,
    2
  );
}

export function parseHeartbeatFinding(text: string): ParsedHeartbeatFinding {
  const raw = normalizeHeartbeatText(text);
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  let findingKey = "";
  let checkName = DEFAULT_HEARTBEAT_CHECK_NAME;
  let message = "";
  const extraLines: string[] = [];

  for (const line of lines) {
    if (/^KEY\s*:/i.test(line)) {
      findingKey = line.replace(/^KEY\s*:/i, "").trim();
      continue;
    }
    if (/^CHECK\s*:/i.test(line)) {
      const nextCheck = line.replace(/^CHECK\s*:/i, "").trim();
      checkName = nextCheck || DEFAULT_HEARTBEAT_CHECK_NAME;
      continue;
    }
    if (/^MESSAGE\s*:/i.test(line)) {
      message = line.replace(/^MESSAGE\s*:/i, "").trim();
      continue;
    }
    extraLines.push(line);
  }

  const combinedMessage = [message, ...extraLines].filter(Boolean).join("\n").trim();
  const nextMessage = combinedMessage || normalizeHeartbeatResponse(raw);
  const nextFindingKey = findingKey || heartbeatFingerprint(nextMessage);

  return {
    checkName: checkName || DEFAULT_HEARTBEAT_CHECK_NAME,
    findingKey: nextFindingKey,
    message: nextMessage
  };
}

export function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function heartbeatDateKey(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: HEARTBEAT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(at);
}