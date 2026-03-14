type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const toolSchema = {
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
} as const;

async function callBridge(params: unknown): Promise<unknown> {
  const bridgeUrl = process.env.LILTO_CRON_BRIDGE_URL?.trim();
  const token = process.env.LILTO_CRON_BRIDGE_TOKEN?.trim();
  const sessionId = process.env.LILTO_CRON_SESSION_ID?.trim() || "default";

  if (!bridgeUrl || !token) {
    throw new Error("cron bridge configuration is missing");
  }

  const response = await fetch(`${bridgeUrl}/command`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      type: "cron.call",
      sessionId,
      params
    })
  });

  const payload = await response.json() as
    | { ok: true; result: unknown }
    | { ok: false; error?: { message?: string } };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `bridge request failed (${response.status})` : payload.error?.message || "bridge request failed");
  }

  return payload.result;
}

function writeMessage(message: JsonRpcResponse): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function success(id: string | number | null, result: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function failure(id: string | number | null, code: number, message: string): void {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMessage(message: JsonRpcRequest): Promise<void> {
  const id = message.id ?? null;

  try {
    switch (message.method) {
      case "initialize":
        success(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "lilto-cron", version: "0.1.0" }
        });
        return;
      case "notifications/initialized":
        return;
      case "ping":
        success(id, {});
        return;
      case "tools/list":
        success(id, {
          tools: [
            {
              name: "cron",
              description: [
                "Schedule notifications for the current chat session.",
                "Prefer high-level operations: set_timer, set_reminder_at, set_daily_reminder.",
                "Use low-level create/update only for complex schedules."
              ].join(" "),
              inputSchema: toolSchema
            }
          ]
        });
        return;
      case "tools/call": {
        const name = typeof message.params?.name === "string" ? message.params.name : "";
        if (name !== "cron") {
          failure(id, -32602, `unknown tool: ${name}`);
          return;
        }
        const result = await callBridge(message.params?.arguments ?? {});
        success(id, result);
        return;
      }
      default:
        failure(id, -32601, `method not found: ${message.method}`);
    }
  } catch (error) {
    failure(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const headerText = buffer.slice(0, headerEnd).toString("utf8");
    const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number(contentLengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (buffer.length < messageEnd) {
      return;
    }

    const body = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(body) as JsonRpcRequest;
    } catch {
      failure(null, -32700, "invalid json");
      continue;
    }

    void handleMessage(parsed);
  }
});

process.stdin.resume();
