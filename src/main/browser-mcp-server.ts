import { randomUUID } from "node:crypto";

import { BROWSER_MCP_PROTOCOL_VERSION, BROWSER_MCP_SERVER_NAME } from "../shared/browser";
import { isBrowserToolName, listBrowserTools, validateToolArguments } from "./browser-tool-contract";

/**
 * stdio MCP server for lilto_browser. stdout carries newline-delimited JSON-RPC only;
 * diagnostics go to stderr without secrets. It never touches Electron APIs.
 */
type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const BACKSTOP_MS = 60_000;
const inflight = new Map<string | number, AbortController>();

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}
const ok = (id: string | number | null, result: unknown) => send({ id, result });
const rpcError = (id: string | number | null, code: number, message: string) => send({ id, error: { code, message } });
const log = (message: string) => process.stderr.write(`[lilto-browser-mcp] ${message}\n`);

function bridgeConfig(): { url: string; token: string } | null {
  const url = process.env.LILTO_BROWSER_BRIDGE_URL?.trim() ?? "";
  const token = process.env.LILTO_BROWSER_BRIDGE_TOKEN?.trim() ?? "";
  if (!token || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) return null;
  return { url, token };
}

function toolResult(payload: Record<string, any>): Record<string, unknown> {
  let image: { data: string; mimeType: string } | null = null;
  let structured = payload;
  const result = payload.ok ? payload.result : undefined;
  if (result && typeof result.imageBase64 === "string") {
    image = { data: result.imageBase64, mimeType: typeof result.mimeType === "string" ? result.mimeType : "image/png" };
    const { imageBase64: _omit, ...rest } = result;
    structured = { ...payload, result: rest };
  }
  const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(structured) }];
  if (image) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return { content, structuredContent: structured, isError: payload.ok !== true };
}

function localError(code: string, message: string, retryable = false): Record<string, unknown> {
  return toolResult({ ok: false, error: { code, message, retryable, effect: "none" } });
}

async function callTool(id: string | number | null, name: string, args: unknown): Promise<void> {
  const config = bridgeConfig();
  if (!config) return ok(id, localError("BROWSER_UNAVAILABLE", "Browser bridge configuration is missing"));
  const controller = new AbortController();
  if (id !== null) inflight.set(id, controller);
  const timer = setTimeout(() => controller.abort(), BACKSTOP_MS);
  try {
    const response = await fetch(`${config.url}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: randomUUID(), tool: name, arguments: args ?? {} }),
      signal: controller.signal
    });
    const payload = (await response.json()) as Record<string, any>;
    if (!payload || typeof payload.ok !== "boolean") return ok(id, localError("INTERNAL_ERROR", "Invalid bridge response"));
    ok(id, toolResult(payload));
  } catch (error) {
    // Cancelled requests get no response (MCP cancellation semantics).
    if (controller.signal.aborted && id !== null && !inflight.has(id)) return;
    log(`bridge call failed: ${error instanceof Error ? error.name : "error"}`);
    ok(id, localError("BROWSER_UNAVAILABLE", "The Lilto browser bridge is unreachable", true));
  } finally {
    clearTimeout(timer);
    if (id !== null) inflight.delete(id);
  }
}

async function handle(message: JsonRpcRequest): Promise<void> {
  const id = message.id ?? null;
  const hasId = message.id !== undefined;
  switch (message.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: BROWSER_MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: BROWSER_MCP_SERVER_NAME, version: "0.1.0" }
      });
    case "notifications/initialized":
      return;
    case "notifications/cancelled": {
      const requestId = message.params?.requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        const controller = inflight.get(requestId);
        inflight.delete(requestId);
        controller?.abort();
      }
      return;
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listBrowserTools() });
    case "tools/call": {
      const name = message.params?.name;
      if (!isBrowserToolName(name)) return rpcError(id, -32602, `unknown tool: ${String(name)}`);
      const validated = validateToolArguments(name, message.params?.arguments);
      if (!validated.ok) return rpcError(id, -32602, `invalid arguments: ${validated.message}`);
      return callTool(id, name, validated.args);
    }
    default:
      if (hasId) rpcError(id, -32601, `method not found: ${String(message.method)}`);
  }
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffered += chunk;
  for (;;) {
    const newline = buffered.indexOf("\n");
    if (newline < 0) return;
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(line) as JsonRpcRequest;
    } catch {
      rpcError(null, -32700, "invalid json");
      continue;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.method !== "string") {
      rpcError(parsed?.id ?? null, -32600, "invalid request");
      continue;
    }
    void handle(parsed).catch((error) => {
      log(`handler failed: ${error instanceof Error ? error.message : "error"}`);
      if (parsed.id !== undefined) rpcError(parsed.id ?? null, -32603, "internal error");
    });
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
