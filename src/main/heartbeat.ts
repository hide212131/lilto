import type { Logger } from "./logger";

type HeartbeatJob = {
  id: string;
  enabled: boolean;
  handler: () => Promise<void> | void;
  lastRunAt: string | null;
};

export class HeartbeatScheduler {
  private readonly intervalMs: number;
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private readonly jobs = new Map<string, HeartbeatJob>();

  constructor({ intervalMs, logger }: { intervalMs: number; logger: Logger }) {
    this.intervalMs = intervalMs;
    this.logger = logger;
  }

  registerJob({
    id,
    enabled = true,
    handler
  }: {
    id: string;
    enabled?: boolean;
    handler: () => Promise<void> | void;
  }): void {
    this.jobs.set(id, { id, enabled, handler, lastRunAt: null });
  }

  setEnabled(id: string, enabled: boolean): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.enabled = enabled;
  }

  start(): void {
    if (this.timer) return;
    this.logger.info("heartbeat_start", { intervalMs: this.intervalMs });
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info("heartbeat_stop");
  }

  async runTick(): Promise<void> {
    this.logger.info("heartbeat_tick", { totalJobs: this.jobs.size });
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      const startedAt = new Date().toISOString();
      try {
        await job.handler();
        job.lastRunAt = startedAt;
        this.logger.info("heartbeat_job_success", { id: job.id, startedAt });
      } catch (error) {
        this.logger.error("heartbeat_job_failed", {
          id: job.id,
          startedAt,
          message: String(error instanceof Error ? error.message : error)
        });
      }
    }
  }
}
