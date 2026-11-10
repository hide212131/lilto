const fs = require("node:fs");
const path = require("node:path");

const BROWSER_MCP_ENTRY = "dist/main/browser-mcp-server.js";

/**
 * Relative-require closure of the MCP entry (repo-relative posix paths, entry included).
 * The MCP child runs under plain Node from app.asar.unpacked, so every file it loads
 * must be unpacked, and it may only require relative files or Node built-ins.
 */
function collectBrowserMcpAssets(rootDir = path.resolve(__dirname, "..")) {
  const seen = new Set();
  const external = new Set();
  const visit = (relative) => {
    if (seen.has(relative)) return;
    seen.add(relative);
    const source = fs.readFileSync(path.join(rootDir, relative), "utf8");
    for (const match of source.matchAll(/require\("([^"]+)"\)/g)) {
      const spec = match[1];
      if (spec.startsWith(".")) {
        let target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec));
        if (!target.endsWith(".js")) target += ".js";
        visit(target);
      } else {
        external.add(spec);
      }
    }
  };
  visit(BROWSER_MCP_ENTRY);
  return { files: [...seen].sort(), external: [...external].sort() };
}

module.exports = { BROWSER_MCP_ENTRY, collectBrowserMcpAssets };
