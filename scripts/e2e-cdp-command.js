const fs = require("node:fs");
const path = require("node:path");

function pickPageTarget(targets) {
  const pageTargets = Array.isArray(targets)
    ? targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl)
    : [];

  return (
    pageTargets.find((target) => String(target.url || "").startsWith("views://")) ||
    pageTargets.find((target) => String(target.title || "").toLowerCase().includes("lilt")) ||
    pageTargets[0] ||
    null
  );
}

async function waitForPageTarget(port, timeoutMs = 30000) {
  const start = Date.now();
  const endpoint = `http://127.0.0.1:${port}/json/list`;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const targets = await response.json();
        const pageTarget = pickPageTarget(targets);
        if (pageTarget) {
          return pageTarget.webSocketDebuggerUrl;
        }
      }
    } catch (_error) {
      // Retry until the page target is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for page target at ${endpoint}`);
}

async function withCdp(port, callback) {
  const wsUrl = await waitForPageTarget(port);
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(event.error || new Error("WebSocket connection failed")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      return;
    }
    const handlers = pending.get(message.id);
    if (!handlers) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      handlers.reject(new Error(message.error.message || JSON.stringify(message.error)));
      return;
    }
    handlers.resolve(message.result || {});
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  try {
    return await callback(send);
  } finally {
    for (const handlers of pending.values()) {
      handlers.reject(new Error("CDP socket closed before response"));
    }
    pending.clear();
    socket.close();
  }
}

function normalizeEvalValue(result) {
  const value = result?.result?.value;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "undefined") {
    return "";
  }
  return JSON.stringify(value);
}

async function main() {
  const [, , port, command, ...rest] = process.argv;
  if (!port || !command) {
    throw new Error("Usage: node scripts/e2e-cdp-command.js <port> <get|eval|screenshot> [...args]");
  }

  if (command === "get") {
    const what = rest[0];
    if (what !== "title") {
      throw new Error(`Unsupported get command: ${what}`);
    }
    const output = await withCdp(port, async (send) => {
      const result = await send("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
        awaitPromise: true
      });
      return normalizeEvalValue(result);
    });
    process.stdout.write(output);
    return;
  }

  if (command === "eval") {
    const expression = rest.join(" ");
    const output = await withCdp(port, async (send) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return normalizeEvalValue(result);
    });
    process.stdout.write(output);
    return;
  }

  if (command === "screenshot") {
    const targetPath = rest[0];
    if (!targetPath) {
      throw new Error("screenshot requires an output path");
    }

    await withCdp(port, async (send) => {
      await send("Page.enable");
      const result = await send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, result.data, "base64");
    });
    return;
  }

  throw new Error(`Unsupported command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
