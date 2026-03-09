const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createBashPolicyGateExtension,
  createTestPolicyConfig,
  evaluateBashAgainstConfig,
  loadBashPolicy
} = require("../dist/main/bash-policy.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lilto-bash-policy-"));
}

function writePolicy(baseDir, body) {
  const config = createTestPolicyConfig(baseDir);
  fs.writeFileSync(config.policyPath, body, "utf8");
  return config;
}

test("default policy: rm -rf と sudo は deny、git push は confirm、ls は allow", () => {
  const baseDir = makeTempDir();
  const config = createTestPolicyConfig(baseDir);

  assert.equal(evaluateBashAgainstConfig({ command: "rm -rf /tmp/demo", cwd: baseDir, config }).decision, "deny");
  assert.equal(evaluateBashAgainstConfig({ command: "sudo ls", cwd: baseDir, config }).decision, "deny");
  assert.equal(evaluateBashAgainstConfig({ command: "git push origin main", cwd: baseDir, config }).decision, "confirm");
  assert.equal(evaluateBashAgainstConfig({ command: "ls -la", cwd: baseDir, config }).decision, "allow");
  assert.equal(evaluateBashAgainstConfig({ command: "unknown-command", cwd: baseDir, config }).decision, "confirm");
});

test("protectedPaths: .env への破壊的操作を拒否する", () => {
  const baseDir = makeTempDir();
  const config = createTestPolicyConfig(baseDir);

  const evaluation = evaluateBashAgainstConfig({
    command: "rm -f .env.local",
    cwd: baseDir,
    config
  });

  assert.equal(evaluation.decision, "deny");
  assert.equal(evaluation.ruleId, "protected-path");
});

test("policy loader: YAML から rules と protectedPaths を読み込める", () => {
  const baseDir = makeTempDir();
  const config = writePolicy(
    baseDir,
    [
      "default: deny",
      "nonInteractiveDefault: deny",
      "protectedPaths:",
      "  - secrets/**",
      "rules:",
      "  - id: allow-echo",
      "    effect: allow",
      "    match:",
      "      type: regex",
      "      pattern: '^echo\\b'",
      "      flags: i"
    ].join("\n")
  );

  const loaded = loadBashPolicy(config);
  assert.equal(loaded.loadError, null);
  assert.equal(loaded.policy.default, "deny");
  assert.deepEqual(loaded.policy.protectedPaths, ["secrets/**"]);
  assert.equal(loaded.policy.rules[0].id, "allow-echo");
});

test("load error fallback: 壊れた YAML は fail-safe mode を適用する", () => {
  const baseDir = makeTempDir();
  const config = createTestPolicyConfig(baseDir, "deny");
  fs.writeFileSync(config.policyPath, "rules:\n  - id broken", "utf8");

  const evaluation = evaluateBashAgainstConfig({
    command: "ls",
    cwd: baseDir,
    config
  });

  assert.equal(evaluation.decision, "deny");
  assert.match(evaluation.reason, /bash policy load failed/);
  assert.ok(evaluation.loadError);
});

test("bypass patterns: sh -c、bash -lc、xargs、複合コマンドでも危険操作を検出する", () => {
  const baseDir = makeTempDir();
  const config = createTestPolicyConfig(baseDir);

  assert.equal(evaluateBashAgainstConfig({ command: 'sh -c "rm -rf tmp"', cwd: baseDir, config }).decision, "deny");
  assert.equal(evaluateBashAgainstConfig({ command: 'bash -lc "sudo apt update"', cwd: baseDir, config }).decision, "deny");
  assert.equal(
    evaluateBashAgainstConfig({ command: 'printf ".env" | xargs rm -f', cwd: baseDir, config }).decision,
    "deny"
  );
  assert.equal(
    evaluateBashAgainstConfig({ command: "git status && rm -rf tmp", cwd: baseDir, config }).decision,
    "deny"
  );
  assert.equal(
    evaluateBashAgainstConfig({ command: "echo ok; git push origin main", cwd: baseDir, config }).decision,
    "confirm"
  );
});

test("gate adapter: deny を block し audit log を出力する", async () => {
  const baseDir = makeTempDir();
  const config = createTestPolicyConfig(baseDir);
  let handler;

  createBashPolicyGateExtension({
    config,
    logger: { info() {}, error() {} }
  })({
    on(eventName, callback) {
      if (eventName === "tool_call") {
        handler = callback;
      }
    }
  });

  const result = await handler(
    { toolName: "bash", input: { command: "rm -rf /tmp/demo" } },
    { cwd: baseDir, hasUI: false, ui: {} }
  );

  assert.equal(result.block, true);
  const auditLines = fs.readFileSync(config.auditLogPath, "utf8").trim().split(/\r?\n/);
  assert.equal(auditLines.length, 1);
  const audit = JSON.parse(auditLines[0]);
  assert.equal(audit.decision, "deny");
  assert.equal(audit.approved, false);
});

test("gate adapter: confirm は UI 承認待ちにし、拒否時は block する", async () => {
  const baseDir = makeTempDir();
  const config = createTestPolicyConfig(baseDir);
  let handler;
  const prompts = [];

  createBashPolicyGateExtension({
    config,
    logger: { info() {}, error() {} }
  })({
    on(eventName, callback) {
      if (eventName === "tool_call") {
        handler = callback;
      }
    }
  });

  const result = await handler(
    { toolName: "bash", input: { command: "git push origin main" } },
    {
      cwd: baseDir,
      hasUI: true,
      ui: {
        async confirm(title, message) {
          prompts.push({ title, message });
          return false;
        }
      }
    }
  );

  assert.equal(result.block, true);
  assert.equal(prompts.length, 1);
  const audit = JSON.parse(fs.readFileSync(config.auditLogPath, "utf8").trim());
  assert.equal(audit.decision, "confirm");
  assert.equal(audit.approved, false);
});

test("gate adapter: audit は実行を許可し監査ログを残す", async () => {
  const baseDir = makeTempDir();
  const config = writePolicy(
    baseDir,
    [
      "default: allow",
      "nonInteractiveDefault: deny",
      "rules:",
      "  - id: audit-curl",
      "    effect: audit",
      "    match:",
      "      type: regex",
      "      pattern: '\\bcurl\\b'",
      "      flags: i"
    ].join("\n")
  );
  let handler;

  createBashPolicyGateExtension({
    config,
    logger: { info() {}, error() {} }
  })({
    on(eventName, callback) {
      if (eventName === "tool_call") {
        handler = callback;
      }
    }
  });

  const result = await handler(
    { toolName: "bash", input: { command: "curl https://example.com" } },
    { cwd: baseDir, hasUI: false, ui: {} }
  );

  assert.equal(result, undefined);
  const audit = JSON.parse(fs.readFileSync(config.auditLogPath, "utf8").trim());
  assert.equal(audit.decision, "audit");
  assert.equal(audit.approved, true);
});
