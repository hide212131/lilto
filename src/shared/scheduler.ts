export type ScheduleKind = "one_shot" | "cron";

export type SchedulerNotificationPayload = {
  sessionId: string;
  message: string;
  followUpInstruction?: string;
};

export type SchedulerScheduleSummary = {
  id: string;
  title?: string;
  kind: ScheduleKind;
  runAt?: string;
  cronExpr?: string;
  timezone: string;
  sessionId: string;
  notificationMessage: string;
  followUpInstruction?: string;
  nextRunAt?: string;
};

export type SchedulerCreateInput = {
  id?: string;
  title?: string;
  kind: ScheduleKind;
  runAt?: string;
  cronExpr?: string;
  timezone?: string;
  notification: SchedulerNotificationPayload;
};

export type SchedulerNotificationEvent = {
  id: string;
  sessionId: string;
  message: string;
  followUpInstruction?: string;
  firedAt: string;
};
