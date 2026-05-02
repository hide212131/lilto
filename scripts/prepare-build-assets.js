const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const electronPath = require("electron");

const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");
const renderIconScript = path.join(rootDir, "scripts", "render-build-icon-electron.js");

fs.mkdirSync(buildDir, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(electronPath, [renderIconScript], { cwd: rootDir, stdio: "inherit", env });
