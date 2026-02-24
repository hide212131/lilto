const fs = require("node:fs");
const path = require("node:path");

const repoApiBase = "https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator";
const outputDir = path.resolve(__dirname, "..", "skills", "bundled", "skill-creator");

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "lilt-o-build-sync",
      "Accept": "application/vnd.github+json"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch JSON: ${url} (${res.status})`);
  }

  return await res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "lilt-o-build-sync"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch file: ${url} (${res.status})`);
  }

  return await res.text();
}

async function downloadEntry(apiUrl, destinationRoot) {
  const entries = await fetchJson(apiUrl);
  if (!Array.isArray(entries)) {
    throw new Error(`Unexpected API response at: ${apiUrl}`);
  }

  for (const entry of entries) {
    const destinationPath = path.join(destinationRoot, entry.name);

    if (entry.type === "dir") {
      fs.mkdirSync(destinationPath, { recursive: true });
      await downloadEntry(entry.url, destinationPath);
      continue;
    }

    if (entry.type !== "file" || !entry.download_url) {
      continue;
    }

    const content = await fetchText(entry.download_url);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, content, "utf8");
  }
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  await downloadEntry(repoApiBase, outputDir);
  console.log(`Synced latest skill-creator to ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
