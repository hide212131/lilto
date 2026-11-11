import http from "node:http";
import type { AddressInfo } from "node:net";

import { BROWSER_LIMITS, type BrowserResult } from "../shared/browser";
import { executeBrowserTool } from "./browser-tool";
import { EVALUATE_TOOL_NAME, isBrowserToolName } from "./browser-tool-contract";
import type { BrowserRunContext } from "./browser-ownership";
import type { EmbeddedBrowserController } from "./embedded-browser";
import type { Logger } from "./logger";

const MAX_IN_FLIGHT = 8;

/**
 * localhost HTTP + Bearer bridge between the stdio MCP child and the controller.
 * The bearer token is the only identity; bodies cannot name a conversation or run.
 */
export class BrowserBridgeServer {
  private server: http.Server | null = null;
  private port = 0;
  private inFlight = 0;
  private readonly activeCommands = new Set<string>();
  private readonly sockets = new Set<import("node:net").Socket>();

  constructor(private readonly controller: EmbeddedBrowserController, private readonly logger: Logger) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    this.server = server;
  }

  /** Stop listening and revoke every capability (settings OFF / app quit). */
  stop(): void {
    this.controller.ownership.revokeAllRuns();
    for (const socket of this.sockets) socket.destroy();
    this.server?.close();
    this.server = null;
    this.port = 0;
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  /** Env for the MCP child only (never the shared App Server process environment). */
  getRunEnv(context: Pick<BrowserRunContext, "token">, options: { evaluateEnabled?: boolean } = {}): Record<string, string> {
    if (!this.server) throw new Error("browser bridge is not started");
    return {
      LILTO_BROWSER_BRIDGE_URL: `http://127.0.0.1:${this.port}`,
      LILTO_BROWSER_BRIDGE_TOKEN: context.token,
      // Visibility snapshot only (which tools to list); Main decides on the live setting.
      LILTO_BROWSER_EVALUATE_ENABLED: options.evaluateEnabled ? "1" : "0",
      ELECTRON_RUN_AS_NODE: "1"
    };
  }

  private reply(res: http.ServerResponse, status: number, body: unknown, sideEffecting = false): void {
    if (res.headersSent || res.writableEnded) return;
    let text = JSON.stringify(body);
    if (Buffer.byteLength(text) > BROWSER_LIMITS.bridgeResponseMaxBytes) {
      // The command already ran: keep whatever effect Main reported (never reset it to "none").
      const original = body as { ok?: boolean; error?: { effect?: string } };
      const effect = original.ok === false && original.error?.effect ? original.error.effect : sideEffecting ? "possible" : "none";
      text = JSON.stringify({ ok: false, error: { code: "RESULT_TOO_LARGE", message: "The result exceeds the response size limit", retryable: false, effect } });
    }
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(text);
  }

  private protocolError(res: http.ServerResponse, status: number, code: string, message: string): void {
    this.reply(res, status, { ok: false, error: { code, message, retryable: status === 429, effect: "none" } });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    if (req.method !== "POST" || req.url !== "/command") return void res.writeHead(404).end();
    // Browsers always send Origin on cross-site POSTs; legitimate MCP clients never do.
    if (req.headers.origin !== undefined) return this.protocolError(res, 403, "INTERNAL_ERROR", "forbidden");
    if (req.headers.host !== `127.0.0.1:${this.port}`) return this.protocolError(res, 403, "INTERNAL_ERROR", "forbidden");
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const run = token ? this.controller.ownership.resolveToken(token) : null;
    if (!run) return this.protocolError(res, 401, "INTERNAL_ERROR", "unauthorized");
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return this.protocolError(res, 415, "INTERNAL_ERROR", "application/json required");
    if (this.inFlight >= MAX_IN_FLIGHT) return this.protocolError(res, 429, "BROWSER_BUSY", "too many concurrent requests");

    this.inFlight += 1;
    const commandAbort = new AbortController();
    let commandId: string | null = null;
    let finished = false;
    res.on("close", () => {
      if (!finished) commandAbort.abort();
    });
    try {
      const raw = await this.readBody(req, res);
      if (raw === null) return;
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return this.protocolError(res, 400, "INTERNAL_ERROR", "invalid json");
      }
      const body = payload as Record<string, unknown>;
      const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
      const valid = keys.length > 0 && keys.every((key) => key === "commandId" || key === "tool" || key === "arguments") &&
        typeof body.commandId === "string" && body.commandId.length > 0 && body.commandId.length <= BROWSER_LIMITS.idMaxLength && isBrowserToolName(body.tool);
      if (!valid) return this.protocolError(res, 400, "INTERNAL_ERROR", "invalid request");
      commandId = `${run.runId}:${body.commandId as string}`;
      if (this.activeCommands.has(commandId)) return this.protocolError(res, 409, "INTERNAL_ERROR", "duplicate commandId");
      this.activeCommands.add(commandId);

      const signal = AbortSignal.any([run.signal, commandAbort.signal]);
      const result: BrowserResult<unknown> = await executeBrowserTool(
        this.controller,
        { runId: run.runId, conversationId: run.conversationId, signal },
        body.tool as never,
        body.arguments
      );
      finished = true;
      this.logger.info("browser_bridge_command", { tool: body.tool, runId: run.runId, ms: Date.now() - started, ok: result.ok, code: result.ok ? undefined : result.error.code });
      this.reply(res, 200, result, body.tool === EVALUATE_TOOL_NAME);
    } finally {
      finished = true;
      if (commandId) this.activeCommands.delete(commandId);
      this.inFlight -= 1;
    }
  }

  private readBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;
      req.on("data", (chunk: Buffer) => {
        if (rejected) return;
        size += chunk.length;
        if (size > BROWSER_LIMITS.bridgeRequestMaxBytes) {
          rejected = true;
          // Flush the 413 before dropping the connection and tell the client not to reuse it.
          res.setHeader("connection", "close");
          res.once("finish", () => req.socket.destroy());
          this.protocolError(res, 413, "INTERNAL_ERROR", "request too large");
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => resolve(null));
      req.on("close", () => resolve(null));
    });
  }
}
