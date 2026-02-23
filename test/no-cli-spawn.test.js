const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const targets = [
  "src/main/agent-sdk.ts",
  "src/main/auth-service.ts",
  "src/main/index.ts",
  "src/main/ipc.ts"
];

test("CLI 別プロセス起動コードを含まない", () => {
  for (const file of targets) {
    const content = fs.readFileSync(file, "utf8");
    assert.equal(/child_process/.test(content), false, `${file} に child_process 参照があります`);
    assert.equal(/\bspawn\s*\(/.test(content), false, `${file} に spawn 呼び出しがあります`);
    assert.equal(/\bexec\s*\(/.test(content), false, `${file} に exec 呼び出しがあります`);
  }
});
