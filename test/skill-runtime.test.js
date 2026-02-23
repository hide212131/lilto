const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseSkillMarkdown,
  discoverSkillMetadata,
  ensureSkillDirInPiSettings,
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
