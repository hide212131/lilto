const path = require("node:path");
const {
  defaultManifest,
  ensureDir,
  ensureReleaseNotes,
  manifestPath,
  normalizeVersion,
  packageMetadata,
  parseArgs,
  releaseDir,
  saveManifest
} = require("./release-common");

function main() {
  const args = parseArgs(process.argv.slice(2));
  const metadata = packageMetadata();
  const version = normalizeVersion(args.version ?? metadata.version);
  const channel = args.channel ?? "candidate";
  const manifest = defaultManifest({
    version,
    channel,
    repository: args["github-repo"] ?? process.env.LILTO_GITHUB_REPOSITORY ?? null,
    gitlabProject: args["gitlab-project"] ?? process.env.LILTO_GITLAB_PROJECT ?? null,
    gitlabHost: args["gitlab-host"] ?? process.env.LILTO_GITLAB_HOST ?? "https://gitlab.com"
  });

  ensureDir(releaseDir(version));
  const notesFile = ensureReleaseNotes(version, metadata.productName);
  manifest.release.notesFile = path.relative(path.resolve(__dirname, ".."), notesFile);
  saveManifest(manifest);

  process.stdout.write(`${manifestPath(version)}\n`);
}

main();
