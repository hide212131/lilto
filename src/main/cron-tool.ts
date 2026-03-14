import type { Logger } from "./logger";
import type { SchedulerClient } from "./scheduler";
import type { SchedulerCreateInput, SchedulerScheduleSummary } from "../shared/scheduler";
const DEFAULT_TIMEZONE = "Asia/Tokyo";

type CronToolOperation =
  | "set_timer"
  | "set_reminder_at"
  | "set_daily_reminder"
  | "create"
  | "list"
  | "update"
  | "delete";

type CronToolParams = {
  operation: CronToolOperation;
  id?: string;
  title?: string;
  kind?: "one_shot" | "cron";
  runAt?: string;
  cronExpr?: string;
  timezone?: string;
  notificationMessage?: string;
  followUpInstruction?: string;
  scope?: "current_session" | "all";
  afterSeconds?: number;
  date?: string;
  time?: string;
  hour?: number;
  minute?: number;
};

function formatSchedule(summary: SchedulerScheduleSummary): string {
  const header = summary.title ? `${summary.id} (${summary.title})` : summary.id;
  const timing = summary.kind === "one_shot"
    ? `runAt=${summary.runAt ?? "unknown"}`
    : `cron=${summary.cronExpr ?? "unknown"} tz=${summary.timezone}`;
  const nextRun = summary.nextRunAt ? ` next=${summary.nextRunAt}` : "";
  return `- ${header}: ${timing}${nextRun}`;
}

export async function createCronTool({
  scheduler,
  logger
}: {
  scheduler: SchedulerClient;
  logger: Logger;
}): Promise<unknown> {
  const execute = createCronToolExecutor({ scheduler, logger });
  return {
    name: "cron",
    label: "Cron",
    description: [
      "Schedule notifications for the current chat session.",
      "Prefer high-level operations: set_timer (afterSeconds), set_reminder_at (date + time + timezone), set_daily_reminder (hour + minute + timezone).",
      "If the user wants the AI to continue with another action after the timer fires, set followUpInstruction to that concrete next step.",
      "Use low-level create/update with runAt or cronExpr only for complex schedules that the high-level operations cannot express."
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: {
          type: "string",
          enum: ["set_timer", "set_reminder_at", "set_daily_reminder", "create", "list", "update", "delete"],
          description: "Operation to perform. Prefer set_timer, set_reminder_at, or set_daily_reminder."
        },
        id: { type: "string", description: "Schedule ID. Required for update/delete." },
        title: { type: "string", description: "Human-readable label for the schedule" },
        kind: { type: "string", enum: ["one_shot", "cron"], description: "Low-level schedule kind. Required only for create/update." },
        runAt: { type: "string", description: "Low-level RFC3339 timestamp for one-shot schedules. Use only with create/update." },
        cronExpr: { type: "string", description: "Low-level 6-field cron expression. Use only with create/update." },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Tokyo" },
        notificationMessage: { type: "string", description: "Message delivered when the schedule fires" },
        followUpInstruction: { type: "string", description: "Optional concrete action for the AI to continue after the notification fires" },
        scope: { type: "string", enum: ["current_session", "all"], description: "For list: current session only (default) or all sessions" },
        afterSeconds: { type: "number", description: "For set_timer: notify after this many seconds" },
        date: { type: "string", description: "For set_reminder_at: local date in YYYY-MM-DD" },
        time: { type: "string", description: "For set_reminder_at: local time in HH:MM or HH:MM:SS" },
        hour: { type: "number", description: "For set_daily_reminder: hour in 24h format (0-23)" },
        minute: { type: "number", description: "For set_daily_reminder: minute (0-59)" }
      },
      required: ["operation"]
    },
    async execute(
      _toolCallId: string,
      rawParams: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { sessionManager: { getSessionId(): string } }
    ) {
      return execute(rawParams, ctx.sessionManager.getSessionId());
    }
  };
}

export function createCronToolExecutor({
  scheduler,
  logger
}: {
  scheduler: SchedulerClient;
  logger: Logger;
}) {
  return async (rawParams: unknown, currentSessionId: string) => {
    const params = rawParams as CronToolParams;

    logger.info("cron_tool_called", {
      operation: params.operation,
      currentSessionId,
      id: params.id ?? null
    });

    if (params.operation === "list") {
      const items = await scheduler.listSchedules();
      const scope = params.scope ?? "current_session";
      const visible = scope === "all" ? items : items.filter((item) => item.sessionId === currentSessionId);
      const lines = visible.length > 0 ? visible.map(formatSchedule).join("\n") : "No schedules found.";
      return {
        content: [{ type: "text", text: lines }],
        details: { items: visible }
      };
    }

    if (params.operation === "delete") {
      if (!params.id) {
        throw new Error("delete operation requires id");
      }
      await scheduler.deleteSchedule(params.id);
      return {
        content: [{ type: "text", text: `Deleted schedule ${params.id}.` }],
        details: { id: params.id, deleted: true }
      };
    }

    const notificationMessage = params.notificationMessage?.trim() || "スケジュールの時刻になりました。";
    const input = buildSchedulerInput(params, currentSessionId, notificationMessage);

    if (
      params.operation === "create" ||
      params.operation === "set_timer" ||
      params.operation === "set_reminder_at" ||
      params.operation === "set_daily_reminder"
    ) {
      const summary = await scheduler.createSchedule(input);
      return {
        content: [{ type: "text", text: `Created schedule:\n${formatSchedule(summary)}` }],
        details: summary
      };
    }

    if (params.operation === "update") {
      if (!params.id) {
        throw new Error("update operation requires id");
      }
      const summary = await scheduler.updateSchedule(params.id, input);
      return {
        content: [{ type: "text", text: `Updated schedule:\n${formatSchedule(summary)}` }],
        details: summary
      };
    }

    throw new Error(`unsupported operation: ${params.operation satisfies never}`);
  };
}

function buildSchedulerInput(
  params: CronToolParams,
  sessionId: string,
  notificationMessage: string
): SchedulerCreateInput {
  switch (params.operation) {
    case "set_timer":
      return buildTimerInput(params, sessionId, notificationMessage);
    case "set_reminder_at":
      return buildReminderAtInput(params, sessionId, notificationMessage);
    case "set_daily_reminder":
      return buildDailyReminderInput(params, sessionId, notificationMessage);
    case "create":
    case "update":
      return buildLowLevelInput(params, sessionId, notificationMessage);
    default:
      throw new Error(`operation ${params.operation} does not create or update schedules`);
  }
}

function buildTimerInput(
  params: CronToolParams,
  sessionId: string,
  notificationMessage: string
): SchedulerCreateInput {
  if (!Number.isFinite(params.afterSeconds) || (params.afterSeconds ?? 0) <= 0) {
    throw new Error("set_timer requires afterSeconds > 0");
  }

  const runAt = new Date(Date.now() + Math.floor(params.afterSeconds!) * 1000).toISOString();
  return {
    title: params.title,
    kind: "one_shot",
    runAt,
    notification: {
      sessionId,
      message: notificationMessage,
      followUpInstruction: sanitizeFollowUpInstruction(params.followUpInstruction)
    }
  };
}

function buildReminderAtInput(
  params: CronToolParams,
  sessionId: string,
  notificationMessage: string
): SchedulerCreateInput {
  if (!params.date?.trim()) {
    throw new Error("set_reminder_at requires date");
  }
  if (!params.time?.trim()) {
    throw new Error("set_reminder_at requires time");
  }

  const timezone = params.timezone?.trim() || DEFAULT_TIMEZONE;
  const runAt = buildRfc3339FromLocalDateTime(params.date, params.time, timezone);
  return {
    title: params.title,
    kind: "one_shot",
    runAt,
    timezone,
    notification: {
      sessionId,
      message: notificationMessage,
      followUpInstruction: sanitizeFollowUpInstruction(params.followUpInstruction)
    }
  };
}

function buildDailyReminderInput(
  params: CronToolParams,
  sessionId: string,
  notificationMessage: string
): SchedulerCreateInput {
  if (!Number.isInteger(params.hour) || params.hour! < 0 || params.hour! > 23) {
    throw new Error("set_daily_reminder requires hour in 0-23");
  }
  if (!Number.isInteger(params.minute) || params.minute! < 0 || params.minute! > 59) {
    throw new Error("set_daily_reminder requires minute in 0-59");
  }

  return {
    title: params.title,
    kind: "cron",
    cronExpr: `0 ${params.minute} ${params.hour} * * *`,
    timezone: params.timezone?.trim() || DEFAULT_TIMEZONE,
    notification: {
      sessionId,
      message: notificationMessage,
      followUpInstruction: sanitizeFollowUpInstruction(params.followUpInstruction)
    }
  };
}

function buildLowLevelInput(
  params: CronToolParams,
  sessionId: string,
  notificationMessage: string
): SchedulerCreateInput {
  if (!params.kind) {
    throw new Error("create/update operation requires kind");
  }
  if (params.kind === "one_shot" && !params.runAt) {
    throw new Error("one_shot schedule requires runAt");
  }
  if (params.kind === "cron" && !params.cronExpr) {
    throw new Error("cron schedule requires cronExpr");
  }

  return {
    id: params.id,
    title: params.title,
    kind: params.kind,
    runAt: params.runAt,
    cronExpr: params.cronExpr,
    timezone: params.timezone,
    notification: {
      sessionId,
      message: notificationMessage,
      followUpInstruction: sanitizeFollowUpInstruction(params.followUpInstruction)
    }
  };
}

function sanitizeFollowUpInstruction(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildRfc3339FromLocalDateTime(date: string, time: string, timezone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dateMatch) {
    throw new Error("date must be YYYY-MM-DD");
  }
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!timeMatch) {
    throw new Error("time must be HH:MM or HH:MM:SS");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");

  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error("time contains out-of-range values");
  }

  const instant = zonedTimeToUtc({ year, month, day, hour, minute, second }, timezone);
  const offsetMinutes = Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - instant.getTime()) / 60000);
  const offset = formatOffset(offsetMinutes);

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}${offset}`;
}

function zonedTimeToUtc(
  value: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timezone: string
): Date {
  const desiredUtcMs = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  let guessMs = desiredUtcMs;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = getTimeZoneParts(new Date(guessMs), timezone);
    const localUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const diffMs = desiredUtcMs - localUtcMs;
    if (diffMs === 0) {
      return new Date(guessMs);
    }
    guessMs += diffMs;
  }

  const resolved = getTimeZoneParts(new Date(guessMs), timezone);
  if (
    resolved.year !== value.year ||
    resolved.month !== value.month ||
    resolved.day !== value.day ||
    resolved.hour !== value.hour ||
    resolved.minute !== value.minute ||
    resolved.second !== value.second
  ) {
    throw new Error(`failed to resolve ${timezone} local date/time`);
  }

  return new Date(guessMs);
}

function getTimeZoneParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => {
    const match = parts.find((part) => part.type === type)?.value;
    if (!match) {
      throw new Error(`failed to read ${type} for timezone ${timezone}`);
    }
    return Number(match);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hour = Math.floor(absolute / 60);
  const minute = absolute % 60;
  return `${sign}${pad(hour, 2)}:${pad(minute, 2)}`;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
