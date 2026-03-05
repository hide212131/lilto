import type { ElectrobunConfig } from "electrobun";

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
      bundleCEF: false
    },
    linux: {
      bundleCEF: false
    },
    win: {
      bundleCEF: false
    }
  }
} satisfies ElectrobunConfig;
