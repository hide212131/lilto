const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const releaseRootDir = path.join(rootDir, "release");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeVersion(version) {
  if (!version || typeof version !== "string") {
    throw new Error("version is required");
  }
  return version.trim().replace(/^v/, "");
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const body = token.slice(2);
    if (body.startsWith("no-")) {
      args[body.slice(3)] = false;
      continue;
    }
    const eqIndex = body.indexOf("=");
    if (eqIndex >= 0) {
      args[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[body] = true;
      continue;
    }
    args[body] = next;
    index += 1;
  }
  return args;
}

function packageMetadata() {
  const pkg = readJson(path.join(rootDir, "package.json"));
  return {
    name: pkg.name,
    productName: pkg.productName ?? pkg.name,
    version: normalizeVersion(pkg.version)
  };
}

function releaseDir(version) {
  return path.join(releaseRootDir, normalizeVersion(version));
}

function manifestPath(version) {
  return path.join(releaseDir(version), "manifest.json");
}

function notesPath(version) {
  return path.join(releaseDir(version), "RELEASE_NOTES.md");
}

function defaultReleaseName(productName, version, channel) {
  return channel === "stable" ? `${productName} ${version}` : `${productName} ${version} (${channel})`;
}

function defaultManifest({
  version,
  channel = "candidate",
  repository = process.env.LILTO_GITHUB_REPOSITORY ?? null,
  gitlabProject = process.env.LILTO_GITLAB_PROJECT ?? null,
  gitlabHost = process.env.LILTO_GITLAB_HOST ?? "https://gitlab.com"
}) {
  const metadata = packageMetadata();
  const normalizedVersion = normalizeVersion(version ?? metadata.version);
  const tag = `v${normalizedVersion}`;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      name: metadata.name,
      productName: metadata.productName,
      version: normalizedVersion
    },
    release: {
      version: normalizedVersion,
      tag,
      channel,
      draft: channel !== "stable",
      prerelease: channel !== "stable",
      name: defaultReleaseName(metadata.productName, normalizedVersion, channel),
      notesFile: path.relative(rootDir, notesPath(normalizedVersion))
    },
    build: {
      outputDir: path.relative(rootDir, path.join(releaseDir(normalizedVersion), "dist")),
      nativeBinary: {
        path: path.relative(rootDir, path.join(rootDir, "native", "scheduler-daemon", "target", "release")),
        required: true
      }
    },
    platforms: {
      macos: {
        prepare: { status: "pending", updatedAt: null },
        package: { status: "pending", updatedAt: null, runner: "macos" },
        verification: {
          status: "pending",
          updatedAt: null,
          checklist: [
            "macOS で package を実行して成果物が生成されている",
            "zip 展開後にアプリが起動する",
            "manifest の artifacts に macOS 成果物が記録されている"
          ]
        },
        artifacts: []
      },
      windows: {
        prepare: { status: "pending", updatedAt: null },
        package: { status: "pending", updatedAt: null, runner: "windows" },
        verification: {
          status: "pending",
          updatedAt: null,
          checklist: [
            "Windows で package:release:win を実行する",
            "生成された portable 実行ファイルで起動確認する",
            "確認後に manifest の windows verification を verified に更新する"
          ]
        },
        handoff: null,
        artifacts: []
      }
    },
    artifacts: [],
    publishTargets: {
      github: {
        repository,
        status: repository ? "pending" : "disabled",
        releaseUrl: null,
        releaseId: null,
        updatedAt: null
      },
      gitlab: {
        project: gitlabProject,
        host: gitlabHost,
        status: gitlabProject ? "pending" : "disabled",
        releaseUrl: null,
        releaseId: null,
        updatedAt: null
      }
    }
  };
}

function loadManifest(version) {
  return readJson(manifestPath(version));
}

function saveManifest(manifest) {
  ensureDir(releaseDir(manifest.release.version));
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath(manifest.release.version), manifest);
}

function ensureReleaseNotes(version, productName) {
  const filePath = notesPath(version);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      `# ${productName} ${version}\n\n## Changes\n- \n\n## Verification\n- [ ] macOS package\n- [ ] Windows package\n- [ ] GitHub publish dry-run\n- [ ] GitLab publish dry-run\n`
    );
  }
  return filePath;
}

function upsertArtifact(manifest, artifact) {
  const key = `${artifact.platform}:${artifact.fileName}`;
  manifest.artifacts = manifest.artifacts.filter((entry) => `${entry.platform}:${entry.fileName}` !== key);
  manifest.artifacts.push(artifact);
  manifest.platforms[artifact.platform].artifacts = manifest.platforms[artifact.platform].artifacts.filter(
    (entry) => `${entry.platform}:${entry.fileName}` !== key
  );
  manifest.platforms[artifact.platform].artifacts.push(artifact);
}

function markPlatformState(manifest, platform, stateKey, status, extra = {}) {
  manifest.platforms[platform][stateKey] = {
    ...manifest.platforms[platform][stateKey],
    ...extra,
    status,
    updatedAt: new Date().toISOString()
  };
}

function relativeToRoot(filePath) {
  return path.relative(rootDir, filePath);
}

module.exports = {
  ensureDir,
  ensureReleaseNotes,
  loadManifest,
  manifestPath,
  defaultManifest,
  normalizeVersion,
  notesPath,
  packageMetadata,
  parseArgs,
  releaseDir,
  relativeToRoot,
  rootDir,
  saveManifest,
  upsertArtifact,
  markPlatformState
};
