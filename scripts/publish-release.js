const fs = require("node:fs");
const path = require("node:path");
const { readFile } = require("node:fs/promises");
const {
  loadManifest,
  parseArgs,
  relativeToRoot,
  rootDir,
  saveManifest
} = require("./release-common");

function ensureOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${response.statusText}`);
  }
}

function guessContentType(fileName) {
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) return "text/yaml";
  if (fileName.endsWith(".blockmap")) return "application/json";
  return "application/octet-stream";
}

async function githubRequest(url, options, token) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {})
    }
  });
  return response;
}

async function ensureGithubRelease(manifest, token) {
  const repository = manifest.publishTargets.github.repository;
  const payload = {
    tag_name: manifest.release.tag,
    name: manifest.release.name,
    body: fs.readFileSync(path.join(rootDir, manifest.release.notesFile), "utf8"),
    draft: manifest.release.draft,
    prerelease: manifest.release.prerelease
  };
  let response = await githubRequest(`https://api.github.com/repos/${repository}/releases/tags/${manifest.release.tag}`, {}, token);
  if (response.status === 404) {
    response = await githubRequest(`https://api.github.com/repos/${repository}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, token);
    ensureOk(response, "github create release");
    return response.json();
  }
  ensureOk(response, "github fetch release");
  const release = await response.json();
  const patchResponse = await githubRequest(`https://api.github.com/repos/${repository}/releases/${release.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, token);
  ensureOk(patchResponse, "github update release");
  return patchResponse.json();
}

async function uploadGithubAsset(uploadUrl, token, filePath, fileName) {
  const baseUrl = uploadUrl.replace(/\{[^}]+\}$/, "");
  const body = await readFile(filePath);
  const response = await githubRequest(`${baseUrl}?name=${encodeURIComponent(fileName)}`, {
    method: "POST",
    headers: { "Content-Type": guessContentType(fileName) },
    body
  }, token);
  ensureOk(response, `github upload asset ${fileName}`);
  return response.json();
}

async function syncGithub(manifest, artifacts, dryRun) {
  const repository = manifest.publishTargets.github.repository;
  if (!repository) {
    return { status: "disabled" };
  }
  if (dryRun) {
    return {
      status: "dry-run",
      repository,
      assets: artifacts.map((artifact) => artifact.fileName)
    };
  }
  const token = process.env.GITHUB_RELEASE_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_RELEASE_TOKEN, GH_TOKEN, or GITHUB_TOKEN is required");
  }
  const release = await ensureGithubRelease(manifest, token);
  const existingAssets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
  for (const artifact of artifacts) {
    const existing = existingAssets.get(artifact.fileName);
    if (existing) {
      const deleteResponse = await githubRequest(
        `https://api.github.com/repos/${repository}/releases/assets/${existing.id}`,
        { method: "DELETE" },
        token
      );
      ensureOk(deleteResponse, `github delete asset ${artifact.fileName}`);
    }
    await uploadGithubAsset(release.upload_url, token, path.join(rootDir, artifact.path), artifact.fileName);
  }
  return {
    status: "published",
    repository,
    releaseUrl: release.html_url,
    releaseId: release.id
  };
}

async function gitlabRequest(url, options, token, isJson = true) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "PRIVATE-TOKEN": token,
      ...(isJson ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  return response;
}

async function ensureGitlabRelease(manifest, token) {
  const project = encodeURIComponent(manifest.publishTargets.gitlab.project);
  const host = manifest.publishTargets.gitlab.host.replace(/\/$/, "");
  const payload = {
    name: manifest.release.name,
    tag_name: manifest.release.tag,
    description: fs.readFileSync(path.join(rootDir, manifest.release.notesFile), "utf8")
  };
  let response = await gitlabRequest(`${host}/api/v4/projects/${project}/releases/${encodeURIComponent(manifest.release.tag)}`, {}, token, false);
  if (response.status === 404) {
    response = await gitlabRequest(`${host}/api/v4/projects/${project}/releases`, {
      method: "POST",
      body: JSON.stringify(payload)
    }, token);
    ensureOk(response, "gitlab create release");
    return response.json();
  }
  ensureOk(response, "gitlab fetch release");
  const updateResponse = await gitlabRequest(
    `${host}/api/v4/projects/${project}/releases/${encodeURIComponent(manifest.release.tag)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    },
    token
  );
  ensureOk(updateResponse, "gitlab update release");
  return updateResponse.json();
}

async function uploadGitlabProjectFile(host, project, token, filePath) {
  const form = new FormData();
  form.append("file", new Blob([await readFile(filePath)]), path.basename(filePath));
  const response = await fetch(`${host}/api/v4/projects/${encodeURIComponent(project)}/uploads`, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": token },
    body: form
  });
  ensureOk(response, `gitlab upload ${path.basename(filePath)}`);
  return response.json();
}

async function syncGitlab(manifest, artifacts, dryRun) {
  const target = manifest.publishTargets.gitlab;
  if (!target.project) {
    return { status: "disabled" };
  }
  if (dryRun) {
    return {
      status: "dry-run",
      project: target.project,
      assets: artifacts.map((artifact) => artifact.fileName)
    };
  }
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    throw new Error("GITLAB_TOKEN is required");
  }
  const host = target.host.replace(/\/$/, "");
  await ensureGitlabRelease(manifest, token);
  const linksResponse = await gitlabRequest(
    `${host}/api/v4/projects/${encodeURIComponent(target.project)}/releases/${encodeURIComponent(manifest.release.tag)}/assets/links`,
    {},
    token,
    false
  );
  ensureOk(linksResponse, "gitlab list release links");
  const existingLinks = new Map((await linksResponse.json()).map((link) => [link.name, link]));

  for (const artifact of artifacts) {
    const uploaded = await uploadGitlabProjectFile(host, target.project, token, path.join(rootDir, artifact.path));
    const existing = existingLinks.get(artifact.fileName);
    if (existing) {
      const deleteResponse = await gitlabRequest(
        `${host}/api/v4/projects/${encodeURIComponent(target.project)}/releases/${encodeURIComponent(manifest.release.tag)}/assets/links/${existing.id}`,
        { method: "DELETE" },
        token,
        false
      );
      ensureOk(deleteResponse, `gitlab delete release link ${artifact.fileName}`);
    }
    const absoluteUrl = uploaded.url.startsWith("http") ? uploaded.url : `${host}${uploaded.url}`;
    const createResponse = await gitlabRequest(
      `${host}/api/v4/projects/${encodeURIComponent(target.project)}/releases/${encodeURIComponent(manifest.release.tag)}/assets/links`,
      {
        method: "POST",
        body: JSON.stringify({
          name: artifact.fileName,
          url: absoluteUrl,
          direct_asset_path: `/binaries/${artifact.fileName}`,
          link_type: "other"
        })
      },
      token
    );
    ensureOk(createResponse, `gitlab create release link ${artifact.fileName}`);
  }

  return {
    status: "published",
    project: target.project,
    releaseUrl: `${host}/${target.project}/-/releases/${manifest.release.tag}`,
    releaseId: manifest.release.tag
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? process.env.LILTO_RELEASE_VERSION;
  if (!version) {
    throw new Error("--version or LILTO_RELEASE_VERSION is required");
  }
  const manifest = loadManifest(version);
  const dryRun = Boolean(args["dry-run"]);
  const artifacts = manifest.artifacts.filter((artifact) => fs.existsSync(path.join(rootDir, artifact.path)));
  if (artifacts.length === 0) {
    throw new Error("No built artifacts found in manifest");
  }

  const githubResult = await syncGithub(manifest, artifacts, dryRun);
  manifest.publishTargets.github = {
    ...manifest.publishTargets.github,
    ...githubResult,
    updatedAt: new Date().toISOString()
  };

  const gitlabResult = await syncGitlab(manifest, artifacts, dryRun);
  manifest.publishTargets.gitlab = {
    ...manifest.publishTargets.gitlab,
    ...gitlabResult,
    updatedAt: new Date().toISOString()
  };

  saveManifest(manifest);
  process.stdout.write(`${relativeToRoot(path.join(rootDir, manifest.release.notesFile))}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
