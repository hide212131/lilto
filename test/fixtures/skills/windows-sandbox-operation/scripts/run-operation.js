const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TEST_URL = "https://example.com/";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function fetchWebResult(url) {
  const response = await fetch(url);
  const body = await response.text();
  return {
    ok: response.ok,
    url,
    status: response.status,
    digest: sha256(body),
    bytes: Buffer.byteLength(body),
    fetchedAt: new Date().toISOString()
  };
}

function attemptOutsideWrite(outsideFile) {
  if (!outsideFile) {
    return { attempted: false, blocked: null, path: null };
  }

  try {
    fs.writeFileSync(outsideFile, "blocked", "utf8");
    return { attempted: true, blocked: false, path: outsideFile };
  } catch (error) {
    return {
      attempted: true,
      blocked: true,
      path: outsideFile,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lilto-sandbox-skill-"));
  const web = await fetchWebResult(process.env.LILTO_SANDBOX_TEST_URL || DEFAULT_TEST_URL);
  const outsideWrite = attemptOutsideWrite(process.env.LILTO_SANDBOX_OUTSIDE_FILE);

  const webResultPath = path.join(workDir, "web-result.json");
  const exeResultPath = path.join(workDir, "exe-result.json");
  const manifestPath = path.join(workDir, "manifest.json");

  fs.writeFileSync(webResultPath, JSON.stringify(web, null, 2), "utf8");

  const manifest = {
    ok: web.ok && (outsideWrite.attempted ? outsideWrite.blocked === true : true),
    workDir,
    manifestPath,
    webResultPath,
    exeResultPath,
    tempRoot: os.tmpdir(),
    web,
    outsideWrite
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(manifest)}\n`);

  if (!manifest.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
