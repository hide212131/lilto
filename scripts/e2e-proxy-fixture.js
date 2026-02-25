const http = require("node:http");

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind server"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function createProxyFixture() {
  const targetServer = http.createServer(async (req, res) => {
    await readBody(req);
    if (req.headers["x-lilto-via-proxy"] !== "1") {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("proxy required");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok-from-proxy");
  });

  const targetPort = await listen(targetServer);
  const targetUrl = `http://127.0.0.1:${targetPort}/external`;

  const proxyServer = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("missing request url");
      return;
    }

    let destination;
    try {
      destination = new URL(req.url);
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("proxy expects absolute URL");
      return;
    }

    const upstream = http.request(
      {
        protocol: destination.protocol,
        hostname: destination.hostname,
        port: destination.port || "80",
        method: req.method,
        path: `${destination.pathname}${destination.search}`,
        headers: {
          host: destination.host,
          "x-lilto-via-proxy": "1"
        }
      },
      (upstreamRes) => {
        const headers = { ...upstreamRes.headers };
        delete headers["transfer-encoding"];
        res.writeHead(upstreamRes.statusCode || 502, headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`proxy error: ${String(error)}`);
    });
    req.pipe(upstream);
  });

  const proxyPort = await listen(proxyServer);
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  return {
    targetUrl,
    proxyUrl,
    async close() {
      await Promise.all([
        new Promise((resolve) => targetServer.close(() => resolve())),
        new Promise((resolve) => proxyServer.close(() => resolve()))
      ]);
    }
  };
}

module.exports = { createProxyFixture };
