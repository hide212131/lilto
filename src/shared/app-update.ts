export type AppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "preparing-install"
  | "installing"
  | "error";

export type AppUpdateSnapshot = {
  status: AppUpdateStatus;
  currentVersion: string;
  targetVersion?: string;
  progress?: number;
  source?: "startup" | "manual";
  message?: string;
  revision: number;
};

export const APP_UPDATE_STATE_CHANNEL = "app-update:state";
export const APP_UPDATE_OPEN_CHANNEL = "app-update:open";
