import { isHeartbeatAssistantSessionId } from "./heartbeat-assistant.js";

/** Narrow structural type: callers pass a Session (or test fixture) without this module importing it. */
export type SidebarSession = {
  id: string;
  backendSessionId?: string;
  isPinned?: boolean;
  updatedAt: number;
  createdAt: number;
};

export type SidebarScheduleRef = { kind: string; sessionId: string };

export function isSessionPinned(session: Pick<SidebarSession, "isPinned">): boolean {
  return session.isPinned === true;
}

/** Updated desc, then created desc, then ID ascending by code unit (never localeCompare). */
function comparePinned(a: SidebarSession, b: SidebarSession): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Heartbeat sessions are never eligible for the pinned group, even if isPinned slipped through as true. */
export function isPinnableSessionId(sessionId: string): boolean {
  return !isHeartbeatAssistantSessionId(sessionId);
}

/** Does not mutate `sessions`; returns a new sorted pinned array and the remaining sessions in input order. */
export function splitPinnedSessions<T extends SidebarSession>(sessions: readonly T[]): { pinned: T[]; rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const session of sessions) {
    if (isSessionPinned(session) && isPinnableSessionId(session.id)) pinned.push(session);
    else rest.push(session);
  }
  return { pinned: [...pinned].sort(comparePinned), rest };
}

export function isCronScheduledSession<T extends SidebarSession>(
  session: T,
  schedules: readonly SidebarScheduleRef[]
): boolean {
  return schedules.some((schedule) => schedule.kind === "cron"
    && (schedule.sessionId === session.id || (!!session.backendSessionId && schedule.sessionId === session.backendSessionId)));
}

export type SidebarListGroups<T> = { pinned: T[]; scheduled: T[]; regular: T[] };

/** Pin split first, then the existing cron/session classification applied only to the non-pinned remainder. */
export function projectListGroups<T extends SidebarSession>(
  sessions: readonly T[],
  schedules: readonly SidebarScheduleRef[]
): SidebarListGroups<T> {
  const { pinned, rest } = splitPinnedSessions(sessions);
  const scheduled = rest.filter((session) => isCronScheduledSession(session, schedules));
  const regular = rest.filter((session) => !isCronScheduledSession(session, schedules));
  return { pinned, scheduled, regular };
}

export type SidebarActivityGroups<T> = { pinned: T[]; rest: T[] };

/** Activity mode has no other categories: the remainder stays a single flat list, in its original order. */
export function projectActivityGroups<T extends SidebarSession>(sessions: readonly T[]): SidebarActivityGroups<T> {
  return splitPinnedSessions(sessions);
}

export type SetConversationPinnedResult =
  | { ok: true; isPinned: boolean }
  | { ok: false; error: { code: string; message: string } };
