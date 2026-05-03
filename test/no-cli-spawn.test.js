const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const targets = [
  "src/main/agent-sdk.ts",
  "src/main/auth-service.ts",
  "src/main/index.ts",
  "src/main/ipc.ts"
];

test("main code does not add unauthorized CLI subprocess spawns", () => {
  for (const file of targets) {
    const content = fs.readFileSync(file, "utf8");
    if (file === "src/main/auth-service.ts") {
      assert.match(
        content,
        /resolveCliInvocation\(this\.codexCommand, \["login"\]\)/,
        "auth-service may only resolve codex login"
      );
      assert.match(
        content,
        /spawn\(invocation\.command, invocation\.args,/,
        "auth-service may only spawn the resolved codex login command"
      );
      continue;
    }

    assert.equal(/child_process/.test(content), false, `${file} references child_process`);
    assert.equal(/\bspawn\s*\(/.test(content), false, `${file} calls spawn`);
    assert.equal(/\bexec\s*\(/.test(content), false, `${file} calls exec`);
  }
});
