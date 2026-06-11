const fs = require("node:fs");
const path = require("node:path");

function listIpcFiles() {
  const ipcDir = path.join("src", "main", "ipc");
  const directoryFiles = fs.existsSync(ipcDir)
    ? fs.readdirSync(ipcDir)
        .filter((file) => file.endsWith(".ts"))
        .sort()
        .map((file) => path.join(ipcDir, file))
    : [];

  return [path.join("src", "main", "ipc.ts"), ...directoryFiles];
}

function readIpcSource() {
  return listIpcFiles()
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

module.exports = {
  listIpcFiles,
  readIpcSource
};