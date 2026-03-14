import http from "node:http";
import { randomUUID } from "node:crypto";

import type { Logger } from "./logger";
import { createCronToolExecutor } from "./cron-tool";
import type { SchedulerClient } from "./scheduler";

type BridgeRequest =
  | { type: "cron.call"; sessionId: string; params: unknown }
  | { type: string };

type BridgeResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string } };

export class SchedulerBridgeServer {
  private readonly logger: Logger;
  private readonly token = randomUUID();
  private readonly executeCron: ReturnType<typeof createCronToolExecutor>;
  private server: http.Server | null = null;
  private port: number | null = null;

  constructor({
    logger,
    scheduler
  }: {
    logger: Logger;
    scheduler: SchedulerClient;
  }) {
    this.logger = logger;
    this.executeCron = createCronToolExecutor({ scheduler, logger });
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("scheduler bridge failed to bind a TCP port"));
          return;
        }
        this.port = address.port;
        this.server?.off("error", reject);
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = null;
  }

  getBridgeEnv(sessionId: string): Record<string, string> {
    if (!this.port) {
      throw new Error("scheduler bridge is not started");
    }

    return {
      LILTO_CRON_BRIDGE_URL: `http://127.0.0.1:${this.port}`,
      LILTO_CRON_BRIDGE_TOKEN: this.token,
      LILTO_CRON_SESSION_ID: sessionId
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST" || req.url !== "/command") {
      res.writeHead(404).end();
      return;
    }

    if (req.headers.authorization !== `Bearer ${this.token}`) {
      res.writeHead(401).end(JSON.stringify({ ok: false, error: { message: "unauthorized" } }));
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    for await (const chunk of req) {
      body += chunk;
    }

    let payload: BridgeRequest;
    try {
      payload = JSON.parse(body) as BridgeRequest;
    } catch (error) {
      this.respond(res, 400, { ok: false, error: { message: `invalid json: ${String(error)}` } });
      return;
    }

    if (!isCronCallRequest(payload)) {
      this.respond(res, 400, { ok: false, error: { message: "invalid request" } });
      return;
    }

    try {
      const result = await this.executeCron(payload.params, payload.sessionId);
      this.respond(res, 200, { ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("scheduler_bridge_command_failed", { message });
      this.respond(res, 500, { ok: false, error: { message } });
    }
  }

  private respond(res: http.ServerResponse, statusCode: number, payload: BridgeResponse): void {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(`${JSON.stringify(payload)}\n`);
  }
}

function isCronCallRequest(payload: BridgeRequest): payload is Extract<BridgeRequest, { type: "cron.call" }> {
  return payload.type === "cron.call" && typeof (payload as { sessionId?: unknown }).sessionId === "string";
}
