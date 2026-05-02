const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

app.whenReady()
  .then(() => {
    const { resolveAppIcon, resolveTrayIcon } = require("../dist/main/icon-assets.js");
    const artifactDir = path.join(__dirname, "..", "test", "artifacts");
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "runtime-app-icon.png"), resolveAppIcon(64).toPNG());
    const trayIcon = resolveTrayIcon(16);
    fs.writeFileSync(path.join(artifactDir, "runtime-tray-icon.png"), trayIcon.toPNG());
    fs.writeFileSync(
      path.join(artifactDir, "runtime-tray-icon-preview.png"),
      trayIcon.resize({ width: 160, height: 160, quality: "nearest" }).toPNG()
    );
  })
  .finally(() => app.quit());
