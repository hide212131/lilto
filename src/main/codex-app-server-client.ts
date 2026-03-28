import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { resolveCliInvocation } from "./command-compat";
import { createLogger, type Logger } from "./logger";

type JsonRpcMessage = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
};

type NotificationWaiter<T> = {
  method: string;
  predicate?: (params: T) => boolean;
  resolve: (params: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class CodexAppServerClient {
  private readonly logger: Logger;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readline: Interface | null = null;
  private nextRequestId = 1;
  private readonly stderrLines: string[] = [];
  private readonly pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    method: string;
  }>();
  private readonly notificationWaiters = new Set<NotificationWaiter<unknown>>();
  private readonly queuedNotifications = new Map<string, unknown[]>();
  private started = false;

  constructor(
    private readonly options: {
      homeDir?: string;
      codexHomeDir: string;
      codexCommand?: string;
      logger?: Logger;
      spawnImpl?: typeof spawn;
    }
  ) {
    this.logger = options.logger ?? createLogger("codex-app-server");
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const spawnImpl = this.options.spawnImpl ?? spawn;
    const invocation = resolveCliInvocation(this.options.codexCommand ?? "codex", ["app-server", "--listen", "stdio://"]);
    const child = spawnImpl(invocation.command, invocation.args, {
      env: {
        ...process.env,
        ...(invocation.env ?? {}),
        ...(this.options.homeDir ? {
          HOME: this.options.homeDir,
          USERPROFILE: this.options.homeDir
        } : {}),
        CODEX_HOME: this.options.codexHomeDir
      },
      stdio: ["pipe", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams;

    this.child = child;
    this.readline = createInterface({ input: child.stdout });
    this.started = true;

    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) {
        return;
      }
      this.stderrLines.push(text);
      if (this.stderrLines.length > 20) {
        this.stderrLines.shift();
      }
    });

    child.once("exit", (code) => {
      const error = new Error(`codex app-server exited unexpectedly (code=${code ?? "unknown"}) stderr=${this.stderrTail()}`);
      this.failAllPending(error);
    });

    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "lilto",
        title: "Lilt-o",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
  }

  async request<T>(method: string, params: Record<string, unknown> | undefined, timeoutMs = 15000): Promise<T> {
    await this.start();
    const child = this.assertChild();
    const requestId = this.nextRequestId++;

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timed out waiting for ${method}. stderr=${this.stderrTail()}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        method
      });

      child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
    });
  }

  async waitForNotification<T>(
    method: string,
    options: { predicate?: (params: T) => boolean; timeoutMs?: number } = {}
  ): Promise<T> {
    const queued = this.queuedNotifications.get(method);
    if (queued && queued.length > 0) {
      const index = queued.findIndex((candidate) => !options.predicate || options.predicate(candidate as T));
      if (index >= 0) {
        const [match] = queued.splice(index, 1);
        return match as T;
      }
    }

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.notificationWaiters.delete(waiter as NotificationWaiter<unknown>);
        reject(new Error(`Timed out waiting for notification ${method}. stderr=${this.stderrTail()}`));
      }, options.timeoutMs ?? 120000);

      const waiter: NotificationWaiter<T> = {
        method,
        predicate: options.predicate,
        resolve: (params) => {
          clearTimeout(timeout);
          this.notificationWaiters.delete(waiter as NotificationWaiter<unknown>);
          resolve(params);
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.notificationWaiters.delete(waiter as NotificationWaiter<unknown>);
          reject(error);
        },
        timeout
      };

      this.notificationWaiters.add(waiter as NotificationWaiter<unknown>);
    });
  }

  close(): void {
    this.readline?.close();
    this.readline = null;

    if (this.child) {
      this.child.kill();
      this.child = null;
    }

    this.started = false;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      this.logger.info("codex_app_server_stdout_non_json", { line: trimmed });
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || `${pending.method} failed`));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (typeof message.method !== "string") {
      return;
    }

    const params = message.params;
    let resolved = false;
    for (const waiter of [...this.notificationWaiters]) {
      if (waiter.method !== message.method) {
        continue;
      }
      const typedParams = params as unknown;
      if (waiter.predicate && !waiter.predicate(typedParams)) {
        continue;
      }
      resolved = true;
      waiter.resolve(typedParams);
      break;
    }

    if (!resolved) {
      const queue = this.queuedNotifications.get(message.method) ?? [];
      queue.push(params);
      if (queue.length > 10) {
        queue.shift();
      }
      this.queuedNotifications.set(message.method, queue);
    }
  }

  private assertChild(): ChildProcessWithoutNullStreams {
    if (!this.child) {
      throw new Error("codex app-server is not running");
    }
    return this.child;
  }

  private stderrTail(): string {
    return this.stderrLines.slice(-10).join("\n");
  }

  private failAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.notificationWaiters.clear();

    this.child = null;
    this.started = false;
  }
}
