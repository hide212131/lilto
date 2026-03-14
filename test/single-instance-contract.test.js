const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("main process は single instance lock を取り second-instance で既存ウィンドウを前面化する", () => {
  const content = fs.readFileSync("src/main/index.ts", "utf8");

  assert.match(content, /const hasSingleInstanceLock = app\.requestSingleInstanceLock\(\);/);
  assert.match(content, /if \(!hasSingleInstanceLock\) \{\s*app\.quit\(\);\s*\} else \{\s*app\.on\("second-instance", \(\) => \{\s*showAndFocusMainWindow\(\);/s);
  assert.match(content, /function showAndFocusMainWindow\(\): void \{[\s\S]*mainWindow\.restore\(\);[\s\S]*mainWindow\.show\(\);[\s\S]*mainWindow\.focus\(\);/);
});
