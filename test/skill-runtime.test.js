const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseSkillMarkdown,
  discoverSkillMetadata,
  ensureSkillDirInPiSettings,
  setupSkillRuntime,
  resolveWorkspaceDir,
  cleanupOldWorkspaces
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

test("settings.json に skills 配列を追加・重複回避できる", () => {
  const root = tempDir("skills-settings");
  const settingsPath = path.join(root, "settings.json");

  const first = ensureSkillDirInPiSettings({
    skillDir: "/tmp/app/skills",
    settingsPaths: [settingsPath]
  });
  assert.equal(first.length, 1);

  const second = ensureSkillDirInPiSettings({
    skillDir: "/tmp/app/skills",
    settingsPaths: [settingsPath]
  });
  assert.equal(second.length, 0);

  const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(saved.skills, ["/tmp/app/skills"]);
});

test("settings.json に複数スキルディレクトリを追加できる", () => {
  const root = tempDir("skills-settings-multi");
  const settingsPath = path.join(root, "settings.json");

  const updated = ensureSkillDirInPiSettings({
    skillDirs: ["/tmp/pi/skills", "/tmp/app/skills/bundled"],
    settingsPaths: [settingsPath]
  });
  assert.equal(updated.length, 1);

  const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(saved.skills, ["/tmp/pi/skills", "/tmp/app/skills/bundled"]);
});

test("作業フォルダは ~/.pi/workspaces/<project> に固定される", () => {
  const workspace = resolveWorkspaceDir("Lilt AI", "/home/demo");
  assert.equal(workspace, path.join("/home/demo", ".pi", "workspaces", "lilt-ai"));
});

test("TTL を超えた古いワークスペースを削除する", () => {
  const root = tempDir("workspaces-cleanup");
  const current = path.join(root, "current");
  const stale = path.join(root, "stale");
  const fresh = path.join(root, "fresh");
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(fresh, { recursive: true });

  const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(stale, oldTime, oldTime);

  const removed = cleanupOldWorkspaces({
    workspaceRoot: root,
    currentWorkspaceDir: current,
    ttlHours: 24 * 7
  });

  assert.equal(removed.includes(stale), true);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(fresh), true);
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

test("setupSkillRuntime は bundled/user の両方を設定して liltobook を含む bundled skills を一覧化する", () => {
  const root = tempDir("setup-runtime");
  const projectRoot = path.join(root, "project");
  const appDataDir = path.join(root, "app-data");
  const homeDir = path.join(root, "home");
  const settingsPath = path.join(root, "settings.json");
  fs.mkdirSync(projectRoot, { recursive: true });

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
  fs.mkdirSync(path.join(projectRoot, "skills", "bundled", "liltobook"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "skills", "bundled", "liltobook", "SKILL.md"),
    `---\nname: liltobook\ndescription: heartbeat playbook\n---\n`
  );
  fs.writeFileSync(path.join(projectRoot, "skills", "bundled", "liltobook", "HEARTBEAT.md"), `# Heartbeat\n`);

  fs.mkdirSync(path.join(homeDir, ".pi", "skills", "custom-one"), { recursive: true });
  fs.writeFileSync(
    path.join(homeDir, ".pi", "skills", "custom-one", "SKILL.md"),
    `---\nname: custom-one\ndescription: user custom\n---\n`
  );

  const runtime = setupSkillRuntime({
    appDataDir,
    projectName: "Lilt AI",
    workspaceTtlHours: 0,
    homeDir,
    settingsPaths: [settingsPath],
    projectRoot
  });

  assert.equal(runtime.bundledSkillsDir, path.join(appDataDir, "skills", "bundled"));
  assert.equal(runtime.userSkillsDir, path.join(homeDir, ".pi", "skills"));
  assert.deepEqual(
    runtime.availableSkills.map((skill) => skill.name).sort(),
    ["agent-browser", "custom-one", "liltobook", "skill-creator"]
  );

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.skills, [path.join(homeDir, ".pi", "skills"), path.join(appDataDir, "skills", "bundled")]);
});
