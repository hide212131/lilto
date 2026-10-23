import type { AppUpdater } from "electron-updater";
import { EventEmitter } from "node:events";
import type { Logger } from "./logger";
import type { AppUpdateSnapshot } from "../shared/app-update";

function loadAutoUpdater(): AppUpdater {
  return require("electron-updater").autoUpdater as AppUpdater;
}

export class AppUpdateService {
  private snapshot: AppUpdateSnapshot;
  private revision = 0;
  private checkPromise: Promise<void> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private installStarted = false;
  private readonly updater: AppUpdater;
  private readonly publish: (state: AppUpdateSnapshot) => void;
  private readonly logger: Logger;
  private readonly prepareForUpdate: () => Promise<boolean>;
  private readonly resumeAfterFailedPreparation: () => Promise<void>;

  constructor({ logger, publish, currentVersion, updater, supported = process.platform === "win32", prepareForUpdate = async () => true, resumeAfterFailedPreparation = async () => undefined }: {
    logger: Logger;
    publish: (state: AppUpdateSnapshot) => void;
    currentVersion: string;
    updater?: AppUpdater;
    supported?: boolean;
    prepareForUpdate?: () => Promise<boolean>;
    resumeAfterFailedPreparation?: () => Promise<void>;
  }) {
    this.logger = logger;
    this.prepareForUpdate = prepareForUpdate;
    this.resumeAfterFailedPreparation = resumeAfterFailedPreparation;
    this.publish = publish;
    this.updater = updater ?? (supported ? loadAutoUpdater() : new EventEmitter() as AppUpdater);
    this.snapshot = {
      status: supported && process.env.LILTO_E2E_MOCK !== "1" ? "idle" : "unsupported",
      currentVersion,
      revision: 0
    };
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.autoRunAppAfterInstall = true;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.on("checking-for-update", () => this.setState({ status: "checking" }));
    this.updater.on("update-available", (info) => this.setState({ status: "available", targetVersion: info.version }));
    this.updater.on("update-not-available", () => this.setState({ status: "idle", targetVersion: undefined }));
    this.updater.on("download-progress", (progress) => this.setState({ status: "downloading", progress: progress.percent }));
    this.updater.on("update-downloaded", (info) => this.setState({ status: "downloaded", targetVersion: info.version, progress: 100 }));
    this.updater.on("error", (error) => {
      this.logger.error("app_update_failed", { message: error.message });
      this.setError("更新を完了できませんでした。ネットワークを確認して再試行してください。");
    });
  }

  getSnapshot(): AppUpdateSnapshot {
    return { ...this.snapshot };
  }

  check(source: "startup" | "manual"): Promise<void> {
    if (["unsupported", "downloading", "downloaded", "preparing-install", "installing"].includes(this.snapshot.status)) {
      return Promise.resolve();
    }
    if (this.checkPromise) {
      if (source === "manual") this.setState({ source });
      return this.checkPromise;
    }
    this.setState({ status: "checking", source, message: undefined });
    const operation = this.updater.checkForUpdates()
      .then((result) => {
        if (!result || this.snapshot.status !== "available") {
          if (this.snapshot.status === "checking") this.setState({ status: "idle" });
        }
      })
      .catch((error: unknown) => {
        this.logger.error("app_update_check_failed", { message: error instanceof Error ? error.message : String(error) });
        this.setError("更新を確認できませんでした。ネットワークを確認して再試行してください。", source);
      })
      .finally(() => { if (this.checkPromise === operation) this.checkPromise = null; });
    this.checkPromise = operation;
    return operation;
  }

  download(): Promise<void> {
    if (this.downloadPromise) return this.downloadPromise;
    if (this.snapshot.status !== "available") return Promise.reject(new Error("更新のダウンロードを開始できません"));
    this.setState({ status: "downloading", progress: 0 });
    const operation = this.updater.downloadUpdate()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error("app_update_download_failed", { message: error instanceof Error ? error.message : String(error) });
        this.setError("更新をダウンロードできませんでした。再試行してください。");
        throw error;
      })
      .finally(() => { if (this.downloadPromise === operation) this.downloadPromise = null; });
    this.downloadPromise = operation;
    return operation;
  }

  async install(): Promise<void> {
    if (this.snapshot.status !== "downloaded" || this.installStarted) throw new Error("インストールできる更新がありません");
    this.installStarted = true;
    let prepared = false;
    this.setState({ status: "preparing-install", message: undefined });
    try {
      if (!await this.prepareForUpdate()) {
        this.setState({ status: "downloaded", message: "実行中の処理が終わってから更新してください。" });
        throw new Error("実行中の処理が終わってから更新してください。");
      }
      prepared = true;
      this.setState({ status: "installing" });
      this.updater.quitAndInstall(false, true);
    } catch (error) {
      this.installStarted = false;
      if (prepared) {
        await this.resumeAfterFailedPreparation();
      }
      this.setState({ status: "downloaded", message: "更新を開始できませんでした。もう一度お試しください。" });
      throw error;
    }
  }

  private setState(update: Partial<AppUpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update, revision: ++this.revision };
    this.publish(this.getSnapshot());
  }

  private setError(message: string, source = this.snapshot.source): void {
    if (this.snapshot.status === "error") return;
    this.setState({ status: "error", message, source });
  }
}
