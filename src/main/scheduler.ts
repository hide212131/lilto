import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

import type { Logger } from "./logger";
import type { SchedulerCreateInput, SchedulerNotificationEvent, SchedulerScheduleSummary } from "../shared/scheduler";

type SchedulerResponse<T> =
  | { type: "response"; request_id: string; ok: true; result: T }
  | { type: "response"; request_id: string; ok: false; error: { code?: string; message: string } };

type SchedulerReady = { type: "ready"; db_path: string };
type SchedulerFired = {
  type: "fired";
  id: string;
  notification: { session_id: string; message: string; follow_up_instruction?: string };
  fired_at: string;
};

type SchedulerEnvelope = SchedulerReady | SchedulerFired | SchedulerResponse<unknown> | { type: "error"; message: string };

export interface SchedulerClient {
  createSchedule(input: SchedulerCreateInput): Promise<SchedulerScheduleSummary>;
  listSchedules(): Promise<SchedulerScheduleSummary[]>;
  updateSchedule(id: string, input: SchedulerCreateInput): Promise<SchedulerScheduleSummary>;
  deleteSchedule(id: string): Promise<void>;
  start(): Promise<void>;
}

export class SchedulerUnavailableError extends Error {
  code = "SCHEDULER_UNAVAILABLE";
}

export class SchedulerService implements SchedulerClient {
  private readonly logger: Logger;
  private readonly userDataDir: string;
  private readonly onNotification: (event: SchedulerNotificationEvent) => void;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private startError: Error | null = null;

  constructor({
    logger,
    userDataDir,
    onNotification
  }: {
    logger: Logger;
    userDataDir: string;
    onNotification: (event: SchedulerNotificationEvent) => void;
  }) {
    this.logger = logger;
    this.userDataDir = userDataDir;
    this.onNotification = onNotification;
  }

  async start(): Promise<void> {
    if (this.startError) {
      throw this.startError;
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const binary = this.resolveBinaryPath();
    if (!existsSync(binary)) {
      this.startError = new SchedulerUnavailableError(`scheduler binary not found: ${binary}`);
      this.logger.info("scheduler_unavailable", { reason: "binary_missing", binary });
      throw this.startError;
    }

    const dbPath = path.join(this.userDataDir, "scheduler.db");
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.process = spawn(binary, [dbPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdout = readline.createInterface({ input: this.process.stdout });
    stdout.on("line", (line) => {
      this.handleLine(line);
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => {
      this.logger.error("scheduler_stderr", { chunk: chunk.toString() });
    });

    this.process.on("exit", (code, signal) => {
      const error = new SchedulerUnavailableError(`scheduler exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      this.logger.error("scheduler_exit", { code, signal });
      this.process = null;
      this.startError = error;
      this.readyReject?.(error);
      this.readyReject = null;
      this.readyResolve = null;
      for (const entry of this.pending.values()) {
        entry.reject(error);
      }
      this.pending.clear();
    });

    return this.readyPromise;
  }

  async createSchedule(input: SchedulerCreateInput): Promise<SchedulerScheduleSummary> {
    return this.sendCommand<SchedulerScheduleSummary>({ cmd: "create", schedule: this.toDaemonSchedule(input) });
  }

  async listSchedules(): Promise<SchedulerScheduleSummary[]> {
    const result = await this.sendCommand<{ items: SchedulerScheduleSummary[] }>({ cmd: "list" });
    return result.items;
  }

  async updateSchedule(id: string, input: SchedulerCreateInput): Promise<SchedulerScheduleSummary> {
    return this.sendCommand<SchedulerScheduleSummary>({
      cmd: "update",
      id,
      schedule: this.toDaemonSchedule(input)
    });
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.sendCommand({ cmd: "delete", id });
  }

  private resolveBinaryPath(): string {
    const executable = process.platform === "win32" ? "scheduler-daemon.exe" : "scheduler-daemon";
    if (process.env.LILTO_SCHEDULER_BIN?.trim()) {
      return process.env.LILTO_SCHEDULER_BIN.trim();
    }
    const developmentBinary = path.join(process.cwd(), "native", "scheduler-daemon", "target", "release", executable);
    const packagedBinary = path.join(process.resourcesPath, "bin", executable);
    if (process.env.NODE_ENV === "production") {
      return packagedBinary;
    }
    if (existsSync(developmentBinary)) {
      return developmentBinary;
    }
    if (existsSync(packagedBinary)) {
      return packagedBinary;
    }
    return developmentBinary;
  }

  private toDaemonSchedule(input: SchedulerCreateInput) {
    return {
      id: input.id,
      title: input.title,
      kind: input.kind,
      run_at: input.runAt,
      cron_expr: input.cronExpr,
      timezone: input.timezone,
      notification: {
        session_id: input.notification.sessionId,
        message: input.notification.message,
        follow_up_instruction: input.notification.followUpInstruction
      }
    };
  }

  private async sendCommand<T>(payload: Record<string, unknown>): Promise<T> {
    await this.start();
    if (!this.process) {
      throw this.startError ?? new SchedulerUnavailableError("scheduler process is not available");
    }

    const requestId = randomUUID();
    const command = { ...payload, request_id: requestId };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.process?.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  private handleLine(line: string): void {
    let payload: SchedulerEnvelope;
    try {
      payload = JSON.parse(line) as SchedulerEnvelope;
    } catch (error) {
      this.logger.error("scheduler_invalid_json", { line, error: String(error) });
      return;
    }

    if (payload.type === "ready") {
      this.logger.info("scheduler_ready", payload);
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    if (payload.type === "fired") {
      this.onNotification({
        id: payload.id,
        sessionId: payload.notification.session_id,
        message: payload.notification.message,
        followUpInstruction: payload.notification.follow_up_instruction,
        firedAt: payload.fired_at
      });
      return;
    }

    if (payload.type === "response") {
      const pending = this.pending.get(payload.request_id);
      if (!pending) {
        return;
      }
      this.pending.delete(payload.request_id);
      if (payload.ok) {
        pending.resolve(this.normalizeSummaryFields(payload.result));
      } else {
        pending.reject(new Error(payload.error.message));
      }
      return;
    }

    this.logger.error("scheduler_error", payload);
  }

  private normalizeSummaryFields(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeSummaryFields(item));
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return {
        items: record.items.map((item) => this.normalizeSummaryFields(item))
      };
    }
    return {
      ...record,
      runAt: typeof record.run_at === "string" ? record.run_at : record.runAt,
      cronExpr: typeof record.cron_expr === "string" ? record.cron_expr : record.cronExpr,
      sessionId: typeof record.session_id === "string" ? record.session_id : record.sessionId,
      notificationMessage:
        typeof record.notification_message === "string" ? record.notification_message : record.notificationMessage,
      followUpInstruction:
        typeof record.follow_up_instruction === "string" ? record.follow_up_instruction : record.followUpInstruction,
      nextRunAt: typeof record.next_run_at === "string" ? record.next_run_at : record.nextRunAt
    };
  }
}
