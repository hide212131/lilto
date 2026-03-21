const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { mock } = require("node:test");

const {
  parseSkillMarkdown,
  discoverSkillMetadata,
  listSkillsWithSource,
  uninstallUserSkill,
  ensureBundledSkills,
  setupSkillRuntime,
  resolveCodexHomeDir,
  resolveCliListedSkillPath,
  parseReleaseUrl,
  computeContentHash,
  checkSkillUpdates
} = require("../dist/main/skill-runtime.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

test("SKILL.md frontmatter から name/description/parameters を取得できる", () => {
  const markdown = `---\nname: demo-skill\ndescription: Demo skill\nparameters: {}\n---\nHello`;
  const parsed = parseSkillMarkdown(markdown, "/tmp/demo/SKILL.md");

  assert.ok(parsed);
  assert.equal(parsed.name, "demo-skill");
  assert.equal(parsed.description, "Demo skill");
  assert.deepEqual(parsed.parameters, {});
});

test("スキルディレクトリを探索して metadata 一覧を作成する", () => {
  const root = tempDir("skills-discovery");
  const skillDir = path.join(root, "agent-browser");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: agent-browser\ndescription: Browser automation\n---\nUse browser`
  );

  const skills = discoverSkillMetadata([root]);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "agent-browser");
});

test("シンボリックリンク先のスキルディレクトリも探索できる", (t) => {
  const root = tempDir("skills-symlink-discovery");
  const actualSkillDir = path.join(root, "actual", "find-skills");
  const linkRoot = path.join(root, "linked");
  const linkPath = path.join(linkRoot, "find-skills");
  fs.mkdirSync(actualSkillDir, { recursive: true });
  fs.mkdirSync(linkRoot, { recursive: true });
  fs.writeFileSync(
    path.join(actualSkillDir, "SKILL.md"),
    `---\nname: find-skills\ndescription: Discover skills\n---\nUse find skills`
  );
  try {
    fs.symlinkSync(actualSkillDir, linkPath, "dir");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("symlink の作成権限がない環境");
      return;
    }
    throw error;
  }

  const skills = discoverSkillMetadata([linkRoot]);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "find-skills");
});

test("Codex home は既定で OS 全体の ~/.codex を使う", { concurrency: false }, () => {
  const previousCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
  try {
    assert.equal(resolveCodexHomeDir("/tmp/lilto-user-data"), path.join(os.homedir(), ".codex"));
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test("Codex home は CODEX_HOME 環境変数で上書きできる", { concurrency: false }, () => {
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(os.tmpdir(), "codex-home-override");
  try {
    assert.equal(resolveCodexHomeDir("/tmp/lilto-user-data"), process.env.CODEX_HOME);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test("resolveCliListedSkillPath は ~\\\\ をホームディレクトリへ展開する", () => {
  assert.equal(
    resolveCliListedSkillPath("~\\lilto\\.agents\\skills\\find-skills"),
    path.join(os.homedir(), "lilto", ".agents", "skills", "find-skills")
  );
});

test("同名スキルがある場合は user skills を優先する", () => {
  const root = tempDir("skills-priority");
  const userDir = path.join(root, "user");
  const bundledDir = path.join(root, "bundled");
  fs.mkdirSync(path.join(userDir, "demo"), { recursive: true });
  fs.mkdirSync(path.join(bundledDir, "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(userDir, "demo", "SKILL.md"),
    `---\nname: demo\ndescription: user version\n---\nUser`
  );
  fs.writeFileSync(
    path.join(bundledDir, "demo", "SKILL.md"),
    `---\nname: demo\ndescription: bundled version\n---\nBundled`
  );

  const skills = discoverSkillMetadata([userDir, bundledDir]);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].description, "user version");
});

test("listSkillsWithSource は user/bundled を source 付きで返す", () => {
  const root = tempDir("skills-list-source");
  const userDir = path.join(root, "user");
  const bundledDir = path.join(root, "bundled");
  fs.mkdirSync(path.join(userDir, "custom-one"), { recursive: true });
  fs.mkdirSync(path.join(bundledDir, "agent-browser"), { recursive: true });
  fs.writeFileSync(
    path.join(userDir, "custom-one", "SKILL.md"),
    `---\nname: custom-one\ndescription: user custom\n---\n`
  );
  fs.writeFileSync(
    path.join(userDir, "custom-one", ".skill-source.json"),
    JSON.stringify({
      url: "https://github.com/owner/repo/releases/download/v1.2.3/skill.zip",
      installedAt: Date.now(),
      installedVersion: "v1.2.3"
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(bundledDir, "agent-browser", "SKILL.md"),
    `---\nname: agent-browser\ndescription: bundled browser\nmetadata:\n  version: "v9.9.9"\n---\n`
  );
  fs.mkdirSync(path.join(userDir, "custom-two"), { recursive: true });
  fs.writeFileSync(
    path.join(userDir, "custom-two", "SKILL.md"),
    `---\nname: custom-two\ndescription: user custom two\nmetadata:\n  version: "0.1.0"\n---\n`
  );

  const listed = listSkillsWithSource({ bundledSkillsDir: bundledDir, userSkillsDir: userDir });
  assert.deepEqual(
    listed
      .map((item) => ({ name: item.name, source: item.source, installedVersion: item.installedVersion }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "agent-browser", source: "bundled", installedVersion: "v9.9.9" },
      { name: "custom-one", source: "user", installedVersion: "v1.2.3" },
      { name: "custom-two", source: "user", installedVersion: "0.1.0" }
    ]
  );
});

test("listSkillsWithSource は user 配下の .system を bundled として扱う", () => {
  const root = tempDir("skills-list-system-filter");
  const userDir = path.join(root, "skills");
  const bundledDir = path.join(userDir, ".system");
  fs.mkdirSync(path.join(userDir, "custom-one"), { recursive: true });
  fs.mkdirSync(path.join(bundledDir, "skill-installer"), { recursive: true });
  fs.writeFileSync(
    path.join(userDir, "custom-one", "SKILL.md"),
    `---\nname: custom-one\ndescription: user custom\n---\n`
  );
  fs.writeFileSync(
    path.join(bundledDir, "skill-installer", "SKILL.md"),
    `---\nname: skill-installer\ndescription: bundled installer\n---\n`
  );

  const listed = listSkillsWithSource({ bundledSkillsDir: bundledDir, userSkillsDir: userDir });
  assert.deepEqual(
    listed
      .map((item) => ({ name: item.name, source: item.source }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "custom-one", source: "user" },
      { name: "skill-installer", source: "bundled" }
    ]
  );
});

test("uninstallUserSkill は user skill を削除し bundled/system を拒否する", () => {
  const root = tempDir("skills-uninstall");
  const userSkillsDir = path.join(root, "user");
  const bundledSkillsDir = path.join(root, "bundled");

  const userSkillDir = path.join(userSkillsDir, "custom-one");
  fs.mkdirSync(userSkillDir, { recursive: true });
  const userSkillFile = path.join(userSkillDir, "SKILL.md");
  fs.writeFileSync(userSkillFile, `---\nname: custom-one\ndescription: user custom\n---\n`);

  const uninstallUser = uninstallUserSkill({ skillFilePath: userSkillFile, userSkillsDir });
  assert.deepEqual(uninstallUser, { ok: true });
  assert.equal(fs.existsSync(userSkillDir), false);

  const bundledSkillDir = path.join(bundledSkillsDir, "agent-browser");
  fs.mkdirSync(bundledSkillDir, { recursive: true });
  const bundledSkillFile = path.join(bundledSkillDir, "SKILL.md");
  fs.writeFileSync(bundledSkillFile, `---\nname: agent-browser\ndescription: bundled\n---\n`);

  const uninstallBundled = uninstallUserSkill({ skillFilePath: bundledSkillFile, userSkillsDir });
  assert.equal(uninstallBundled.ok, false);
  if (!uninstallBundled.ok) {
    assert.match(uninstallBundled.error, /Cannot uninstall bundled or system skills/);
  }
});

test("uninstallUserSkill は user 配下の .system を拒否する", () => {
  const root = tempDir("skills-uninstall-system");
  const userSkillsDir = path.join(root, "skills");
  const systemSkillDir = path.join(userSkillsDir, ".system", "skill-installer");
  fs.mkdirSync(systemSkillDir, { recursive: true });
  const systemSkillFile = path.join(systemSkillDir, "SKILL.md");
  fs.writeFileSync(systemSkillFile, `---\nname: skill-installer\ndescription: bundled\n---\n`);

  const result = uninstallUserSkill({ skillFilePath: systemSkillFile, userSkillsDir });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Cannot uninstall bundled or system skills/);
  }
  assert.equal(fs.existsSync(systemSkillDir), true);
});

test("setupSkillRuntime は CODEX_HOME 配下に bundled/user skills を配置し projectRoot を作業ディレクトリにする", { concurrency: false }, () => {
  const previousCodexHome = process.env.CODEX_HOME;
  const root = tempDir("setup-runtime");
  const projectRoot = path.join(root, "project");
  const appDataDir = path.join(root, "app-data");
  const codexHomeDir = path.join(root, "codex-home");
  const legacyCodexHomeDir = path.join(appDataDir, "codex");
  process.env.CODEX_HOME = codexHomeDir;
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(path.join(legacyCodexHomeDir, ".sandbox-secrets"), { recursive: true });
  fs.writeFileSync(path.join(legacyCodexHomeDir, ".sandbox-secrets", "sandbox_users.json"), "stale");

  fs.mkdirSync(path.join(projectRoot, "node_modules", "agent-browser", "skills", "agent-browser"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "node_modules", "agent-browser", "skills", "agent-browser", "SKILL.md"),
    `---\nname: agent-browser\ndescription: bundled browser\n---\n`
  );

  fs.mkdirSync(path.join(projectRoot, "skills", "bundled", "skill-creator"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "skills", "bundled", "skill-creator", "SKILL.md"),
    `---\nname: skill-creator\ndescription: bundled skill creator\n---\n`
  );

  const userSkillsDir = path.join(projectRoot, ".agents", "skills");
  fs.mkdirSync(path.join(userSkillsDir, "custom-one"), { recursive: true });
  fs.writeFileSync(
    path.join(userSkillsDir, "custom-one", "SKILL.md"),
    `---\nname: custom-one\ndescription: user custom\n---\n`
  );
  fs.mkdirSync(path.join(projectRoot, ".codex", "skills", "repo-only"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, ".codex", "skills", "repo-only", "SKILL.md"),
    `---\nname: repo-only\ndescription: repo leaked skill\n---\n`
  );

  try {
    const runtime = setupSkillRuntime({
      appDataDir,
      projectName: "Lilt AI",
      projectRoot
    });

    assert.equal(runtime.homeDir, appDataDir);
    assert.equal(runtime.codexHomeDir, codexHomeDir);
    assert.equal(runtime.bundledSkillsDir, path.join(codexHomeDir, "skills", ".system"));
    assert.equal(runtime.userSkillsDir, userSkillsDir);
    assert.equal(runtime.workspaceDir, projectRoot);
    assert.deepEqual(
      runtime.availableSkills.map((skill) => skill.name).sort(),
      ["agent-browser", "custom-one", "skill-creator"]
    );
    assert.deepEqual(runtime.updatedSettings, [path.join(codexHomeDir, "config.toml")]);
    assert.deepEqual(runtime.removedWorkspaces, []);
    const configToml = fs.readFileSync(path.join(codexHomeDir, "config.toml"), "utf8");
    assert.equal(configToml.includes("repo-only\\\\SKILL.md"), true);
    assert.match(configToml, /enabled = false/);
    assert.equal(configToml.includes(".agents\\\\skills"), false);
    assert.equal(fs.existsSync(path.join(legacyCodexHomeDir, ".sandbox-secrets", "sandbox_users.json")), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

// ─── parseReleaseUrl ─────────────────────────────────────────────────────────

test("parseReleaseUrl: GitHub releases/download URL は version と ref を返す", () => {
  const info = parseReleaseUrl("https://github.com/owner/repo/releases/download/v1.2.3/skill.zip");
  assert.ok(info);
  assert.equal(info.type, "github");
  assert.equal(info.version, "v1.2.3");
  assert.equal(info.ref, "v1.2.3");
});

test("parseReleaseUrl: GitHub archive refs/tags URL は version と ref を返す", () => {
  const info = parseReleaseUrl("https://github.com/owner/repo/archive/refs/tags/v2.0.0.zip");
  assert.ok(info);
  assert.equal(info.type, "github");
  assert.equal(info.version, "v2.0.0");
  assert.equal(info.ref, "v2.0.0");
});

test("parseReleaseUrl: GitHub archive refs/heads URL は version=null と branch ref を返す", () => {
  const info = parseReleaseUrl("https://github.com/owner/repo/archive/refs/heads/main.zip");
  assert.ok(info);
  assert.equal(info.type, "github");
  assert.equal(info.version, null);
  assert.equal(info.ref, "main");
});

test("parseReleaseUrl: GitHub archive 短縮形 URL は version=null と ref を返す", () => {
  const info = parseReleaseUrl("https://github.com/owner/repo/archive/develop.zip");
  assert.ok(info);
  assert.equal(info.type, "github");
  assert.equal(info.version, null);
  assert.equal(info.ref, "develop");
});

test("parseReleaseUrl: GitLab releases URL は version と ref を返す", () => {
  const info = parseReleaseUrl("https://gitlab.com/ns/repo/-/releases/v1.0.0/downloads/skill.zip");
  assert.ok(info);
  assert.equal(info.type, "gitlab");
  assert.equal(info.version, "v1.0.0");
  assert.equal(info.ref, "v1.0.0");
});

test("parseReleaseUrl: 非 GitHub/GitLab URL は null を返す", () => {
  const info = parseReleaseUrl("https://example.com/skill.zip");
  assert.equal(info, null);
});

// ─── computeContentHash ───────────────────────────────────────────────────────

test("computeContentHash は Buffer の SHA-256 ハッシュを返す", () => {
  const data = Buffer.from("hello");
  const expected = crypto.createHash("sha256").update(data).digest("hex");
  assert.equal(computeContentHash(data), expected);
});

test("computeContentHash は内容が異なると異なるハッシュを返す", () => {
  const h1 = computeContentHash(Buffer.from("content-a"));
  const h2 = computeContentHash(Buffer.from("content-b"));
  assert.notEqual(h1, h2);
});

// ─── checkSkillUpdates ────────────────────────────────────────────────────────

function makeSkillDir(userSkillsDir, skillName, sourceRecord) {
  const dir = path.join(userSkillsDir, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${skillName}\ndescription: test\n---\n`);
  fs.writeFileSync(path.join(dir, ".skill-source.json"), JSON.stringify(sourceRecord, null, 2));
}

test("checkSkillUpdates: local SKILL.md mtime で更新あり を検出する", async () => {
  const root = tempDir("update-check-local-mtime");
  const localSourceDir = tempDir("local-source");
  const sourceSkillDir = path.join(localSourceDir, "local-skill");
  const sourceSkillPath = path.join(sourceSkillDir, "SKILL.md");
  fs.mkdirSync(sourceSkillDir, { recursive: true });
  fs.writeFileSync(sourceSkillPath, `---\nname: local-skill\ndescription: local source\nmetadata:\n  version: "1.0.0"\n---\n`);
  const initialMtime = fs.statSync(sourceSkillPath).mtimeMs;

  makeSkillDir(root, "local-skill", {
    url: localSourceDir,
    installedAt: Date.now(),
    installedVersion: null,
    sourceSkillPath,
    sourceSkillMtime: initialMtime
  });
  fs.writeFileSync(
    path.join(root, "local-skill", "SKILL.md"),
    `---\nname: local-skill\ndescription: installed local skill\nmetadata:\n  version: "0.1.0"\n---\n`
  );

  const updatedTime = new Date(Date.now() + 2_000);
  fs.utimesSync(sourceSkillPath, updatedTime, updatedTime);

  const results = await checkSkillUpdates({ userSkillsDir: root });
  assert.equal(results.length, 1);
  assert.equal(results[0].updateAvailable, true);
  assert.equal(results[0].updateCheckMethod, "local-skill-mtime");
  assert.equal(results[0].installedVersion, "0.1.0");
  assert.equal(results[0].latestVersion, "1.0.0");
});

test("checkSkillUpdates: local SKILL.md mtime が同じなら更新なし", async () => {
  const root = tempDir("update-check-local-mtime-same");
  const localSourceDir = tempDir("local-source-same");
  const sourceSkillDir = path.join(localSourceDir, "local-skill");
  const sourceSkillPath = path.join(sourceSkillDir, "SKILL.md");
  fs.mkdirSync(sourceSkillDir, { recursive: true });
  fs.writeFileSync(sourceSkillPath, `---\nname: local-skill\ndescription: local source\nmetadata:\n  version: "0.1.0"\n---\n`);
  const initialMtime = fs.statSync(sourceSkillPath).mtimeMs;

  makeSkillDir(root, "local-skill", {
    url: localSourceDir,
    installedAt: Date.now(),
    installedVersion: null,
    sourceSkillPath,
    sourceSkillMtime: initialMtime
  });

  const results = await checkSkillUpdates({ userSkillsDir: root });
  assert.equal(results.length, 1);
  assert.equal(results[0].updateAvailable, false);
  assert.equal(results[0].updateCheckMethod, "local-skill-mtime");
  assert.equal(results[0].latestVersion, "0.1.0");
});

test("checkSkillUpdates: symlink されたスキルディレクトリも更新確認対象になる", async (t) => {
  const root = tempDir("update-check-symlink");
  const actualRoot = tempDir("update-check-symlink-actual");
  const actualSkillDir = path.join(actualRoot, "symlink-skill");
  fs.mkdirSync(actualSkillDir, { recursive: true });

  fs.writeFileSync(path.join(actualSkillDir, "SKILL.md"), `---\nname: symlink-skill\ndescription: test\n---\n`);
  fs.writeFileSync(path.join(actualSkillDir, ".skill-source.json"), JSON.stringify({
    url: "https://example.com/skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    etag: '"old-etag"'
  }, null, 2));

  try {
    fs.symlinkSync(actualSkillDir, path.join(root, "symlink-skill"), "dir");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("symlink の作成権限がない環境");
      return;
    }
    throw error;
  }

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    headers: {
      get: (name) => {
        if (name === "etag") return '"new-etag"';
        return null;
      }
    }
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].skillName, "symlink-skill");
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].updateCheckMethod, "etag");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: release-tag で更新あり を検出する", async () => {
  const root = tempDir("update-check-release");
  makeSkillDir(root, "my-skill", {
    url: "https://github.com/owner/repo/releases/download/v1.0.0/skill.zip",
    installedAt: Date.now(),
    installedVersion: "v1.0.0"
  });

  let calledUrl = null;
  const fetchMock = mock.method(global, "fetch", async (url) => {
    calledUrl = url;
    return {
      ok: true,
      json: async () => ({ tag_name: "v2.0.0" })
    };
  });

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].latestVersion, "v2.0.0");
    assert.equal(results[0].updateCheckMethod, "release-tag");
    assert.match(calledUrl, /api\.github\.com\/repos\/owner\/repo\/releases\/latest/);
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: release-tag で更新なし を正しく判定する", async () => {
  const root = tempDir("update-check-no-release");
  makeSkillDir(root, "my-skill", {
    url: "https://github.com/owner/repo/releases/download/v2.0.0/skill.zip",
    installedAt: Date.now(),
    installedVersion: "v2.0.0"
  });

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    json: async () => ({ tag_name: "v2.0.0" })
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, false);
    assert.equal(results[0].updateCheckMethod, "release-tag");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: commit-sha で更新あり を検出する", async () => {
  const root = tempDir("update-check-sha");
  makeSkillDir(root, "branch-skill", {
    url: "https://github.com/owner/repo/archive/refs/heads/main.zip",
    installedAt: Date.now(),
    installedVersion: null,
    commitSha: "aaabbbccc111"
  });

  const calledUrls = [];
  const fetchMock = mock.method(global, "fetch", async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes("/commits/main")) {
      return {
        ok: true,
        json: async () => ({ sha: "dddeeefff222" })
      };
    }
    return {
      ok: true,
      text: async () => "---\nname: branch-skill\ndescription: test\nmetadata:\n  version: \"1.2.3\"\n---\n"
    };
  });

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].updateCheckMethod, "commit-sha");
    assert.equal(results[0].latestVersion, "1.2.3");
    assert.ok(calledUrls.some((url) => /api\.github\.com\/repos\/owner\/repo\/commits\/main/.test(url)));
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: commit-sha で更新なし を正しく判定する", async () => {
  const root = tempDir("update-check-sha-same");
  makeSkillDir(root, "branch-skill", {
    url: "https://github.com/owner/repo/archive/refs/heads/main.zip",
    installedAt: Date.now(),
    installedVersion: null,
    commitSha: "aaabbbccc111"
  });

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    json: async () => ({ sha: "aaabbbccc111" })
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, false);
    assert.equal(results[0].updateCheckMethod, "commit-sha");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: commitSha 未記録の branch ソースは更新不明 (none) になる", async () => {
  const root = tempDir("update-check-sha-missing");
  makeSkillDir(root, "branch-skill", {
    url: "https://github.com/owner/repo/archive/refs/heads/main.zip",
    installedAt: Date.now(),
    installedVersion: null
    // commitSha なし (旧レコード)
  });

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    json: async () => ({ sha: "dddeeefff222" })
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, false);
    assert.equal(results[0].updateCheckMethod, "none");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: GitHub リポジトリURL + commitSha で更新あり を検出する", async () => {
  const root = tempDir("update-check-github-repo-sha");
  makeSkillDir(root, "repo-skill", {
    url: "https://github.com/owner/repo",
    installedAt: Date.now(),
    installedVersion: null,
    commitSha: "oldsha123"
  });

  const calledUrls = [];
  const fetchMock = mock.method(global, "fetch", async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes("/repos/owner/repo/commits/main")) {
      return {
        ok: true,
        json: async () => ({ sha: "newsha456" })
      };
    }
    return {
      ok: true,
      json: async () => ({ default_branch: "main" })
    };
  });

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].updateCheckMethod, "commit-sha");
    assert.ok(calledUrls.some((url) => /api\.github\.com\/repos\/owner\/repo$/.test(url)));
    assert.ok(calledUrls.some((url) => /api\.github\.com\/repos\/owner\/repo\/commits\/main/.test(url)));
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: ETag で更新あり を検出する", async () => {
  const root = tempDir("update-check-etag");
  makeSkillDir(root, "http-skill", {
    url: "https://example.com/skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    etag: '"old-etag-123"'
  });

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    headers: {
      get: (name) => {
        if (name === "etag") return '"new-etag-456"';
        if (name === "last-modified") return null;
        return null;
      }
    }
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].updateCheckMethod, "etag");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: ETag が同じなら更新なし を正しく判定する", async () => {
  const root = tempDir("update-check-etag-same");
  makeSkillDir(root, "http-skill", {
    url: "https://example.com/skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    etag: '"same-etag-123"'
  });

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    headers: {
      get: (name) => {
        if (name === "etag") return '"same-etag-123"';
        return null;
      }
    }
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, false);
    assert.equal(results[0].updateCheckMethod, "etag");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: Last-Modified で更新あり を検出する", async () => {
  const root = tempDir("update-check-lastmod");
  makeSkillDir(root, "http-skill", {
    url: "https://example.com/skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    lastModified: "Mon, 01 Jan 2024 00:00:00 GMT"
  });

  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: true,
    headers: {
      get: (name) => {
        if (name === "etag") return null;
        if (name === "last-modified") return "Tue, 02 Jan 2024 00:00:00 GMT";
        return null;
      }
    }
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].updateCheckMethod, "last-modified");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: content-hash フォールバックで更新あり を検出する", async () => {
  const root = tempDir("update-check-hash");
  const originalContent = Buffer.from("original-skill-content");
  const originalHash = computeContentHash(originalContent);

  makeSkillDir(root, "http-skill", {
    url: "https://example.com/skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    contentHash: originalHash
  });

  const newContent = Buffer.from("updated-skill-content");
  const fetchMock = mock.method(global, "fetch", async (url, opts) => {
    if (opts && opts.method === "HEAD") {
      return {
        ok: true,
        headers: { get: () => null }
      };
    }
    return {
      ok: true,
      arrayBuffer: async () => newContent.buffer.slice(newContent.byteOffset, newContent.byteOffset + newContent.byteLength)
    };
  });

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, true);
    assert.equal(results[0].updateCheckMethod, "content-hash");
  } finally {
    fetchMock.mock.restore();
  }
});

test("checkSkillUpdates: content-hash フォールバックで更新なし を正しく判定する", async () => {
  const root = tempDir("update-check-hash-same");
  const content = Buffer.from("same-skill-content");
  const contentHash = computeContentHash(content);

  makeSkillDir(root, "http-skill", {
    url: "https://example.com/skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    contentHash
  });

  const fetchMock = mock.method(global, "fetch", async (url, opts) => {
    if (opts && opts.method === "HEAD") {
      return {
        ok: true,
        headers: { get: () => null }
      };
    }
    return {
      ok: true,
      arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)
    };
  });

  try {
    const results = await checkSkillUpdates({ userSkillsDir: root });
    assert.equal(results.length, 1);
    assert.equal(results[0].updateAvailable, false);
    assert.equal(results[0].updateCheckMethod, "content-hash");
  } finally {
    fetchMock.mock.restore();
  }
});

test("ensureBundledSkills writes .skill-source.json for bundled skills", () => {
  const root = tempDir("ensure-bundled-source");
  const projectRoot = path.join(root, "project");
  const bundledSkillsDir = path.join(root, "app-data", "skills", "bundled");

  fs.mkdirSync(path.join(projectRoot, "node_modules", "agent-browser", "skills", "agent-browser"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "node_modules", "agent-browser", "skills", "agent-browser", "SKILL.md"),
    `---\nname: agent-browser\ndescription: bundled browser\nmetadata:\n  version: "0.13.0"\n---\n`
  );

  fs.mkdirSync(path.join(projectRoot, "skills", "bundled", "skill-creator"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "skills", "bundled", "skill-creator", "SKILL.md"),
    `---\nname: skill-creator\ndescription: bundled skill creator\nmetadata:\n  version: "1.0.0"\n---\n`
  );

  ensureBundledSkills({ bundledSkillsDir, projectRoot });

  const agentBrowserSource = JSON.parse(
    fs.readFileSync(path.join(bundledSkillsDir, "agent-browser", ".skill-source.json"), "utf8")
  );
  const skillCreatorSource = JSON.parse(
    fs.readFileSync(path.join(bundledSkillsDir, "skill-creator", ".skill-source.json"), "utf8")
  );

  assert.equal(agentBrowserSource.url, "https://github.com/vercel-labs/agent-browser");
  assert.equal(agentBrowserSource.installedVersion, "0.13.0");
  assert.equal(skillCreatorSource.url, "https://github.com/anthropics/skills");
  assert.equal(skillCreatorSource.installedVersion, "1.0.0");
});

test("checkSkillUpdates includes bundled skills when source metadata exists", async () => {
  const root = tempDir("update-check-bundled");
  const userSkillsDir = path.join(root, "user");
  const bundledSkillsDir = path.join(root, "bundled");

  makeSkillDir(userSkillsDir, "user-skill", {
    url: "https://example.com/user-skill.zip",
    installedAt: Date.now(),
    installedVersion: null,
    etag: "\"old-user\""
  });

  fs.mkdirSync(path.join(bundledSkillsDir, "agent-browser"), { recursive: true });
  fs.writeFileSync(
    path.join(bundledSkillsDir, "agent-browser", "SKILL.md"),
    `---\nname: agent-browser\ndescription: bundled browser\nmetadata:\n  version: "0.13.0"\n---\n`
  );
  fs.writeFileSync(
    path.join(bundledSkillsDir, "agent-browser", ".skill-source.json"),
    JSON.stringify({
      url: "https://example.com/agent-browser.zip",
      installedAt: Date.now(),
      installedVersion: "0.13.0",
      etag: "\"old-bundled\""
    }, null, 2)
  );

  const fetchMock = mock.method(global, "fetch", async (url) => ({
    ok: true,
    headers: {
      get: (name) => {
        if (name === "etag") {
          return String(url).includes("agent-browser") ? "\"new-bundled\"" : "\"new-user\"";
        }
        return null;
      }
    }
  }));

  try {
    const results = await checkSkillUpdates({ userSkillsDir, bundledSkillsDir });
    const summary = results
      .map((item) => ({ name: item.skillName, source: item.source, update: item.updateAvailable }))
      .sort((a, b) => a.name.localeCompare(b.name));

    assert.deepEqual(summary, [
      { name: "agent-browser", source: "bundled", update: true },
      { name: "user-skill", source: "user", update: true }
    ]);
  } finally {
    fetchMock.mock.restore();
  }
});
