const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build");
const sourceIcon = path.join(rootDir, "src", "renderer", "public", "mascot.png");
const outputIcon = path.join(buildDir, "icon.png");

fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(sourceIcon, outputIcon);
