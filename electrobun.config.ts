import type { ElectrobunConfig } from "electrobun";

const e2eCdpPort = process.env.LILTO_E2E_CDP_PORT;
const e2eUseCef = process.env.LILTO_E2E_USE_CEF === "1";
const e2eChromiumFlags = e2eCdpPort
  ? {
      "remote-debugging-port": e2eCdpPort
    }
  : undefined;
const useCefForE2E = e2eUseCef || Boolean(e2eCdpPort);

export default {
  app: {
    name: "lilt-o",
    identifier: "sh.hide212131.lilto",
    version: "0.1.0"
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts"
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts"
      }
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html"
    },
    mac: {
      bundleCEF: useCefForE2E,
      defaultRenderer: useCefForE2E ? "cef" : "native",
      chromiumFlags: e2eChromiumFlags
    },
    linux: {
      bundleCEF: useCefForE2E,
      defaultRenderer: useCefForE2E ? "cef" : "native",
      chromiumFlags: e2eChromiumFlags
    },
    win: {
      bundleCEF: useCefForE2E,
      defaultRenderer: useCefForE2E ? "cef" : "native",
      chromiumFlags: e2eChromiumFlags
    }
  }
} satisfies ElectrobunConfig;
