import type { spawn } from "node:child_process";
import { normalizeWorkingDirectory } from "./command-compat";
import { CodexAppServerClient } from "./codex-app-server-client";
import { createLogger, type Logger } from "./logger";
import type { WindowsSandboxMode } from "../shared/provider-settings";

export type WindowsSandboxSetupErrorCode =
  | "WINDOWS_SANDBOX_SETUP_FAILED"
  | "WINDOWS_SANDBOX_SETUP_CANCELED"
  | "WINDOWS_SANDBOX_UNSUPPORTED_MODE";

export type WindowsSandboxSetupResult =
  | { ok: true; mode: Exclude<WindowsSandboxMode, "off">; message: string }
  | { ok: false; error: { code: WindowsSandboxSetupErrorCode; message: string; retryable: boolean } };

type WindowsSandboxSetupCompletedNotification = {
  mode: Exclude<WindowsSandboxMode, "off">;
  success: boolean;
  error?: string | null;
};

function toSetupError(message: string): { code: WindowsSandboxSetupErrorCode; message: string; retryable: boolean } {
  const normalized = message.trim() || "Windows sandbox のセットアップに失敗しました。";
  const lowered = normalized.toLowerCase();

  if (lowered.includes("cancel")) {
    return {
      code: "WINDOWS_SANDBOX_SETUP_CANCELED",
      message: normalized,
      retryable: true
    };
  }

  if (lowered.includes("only available on windows") || lowered.includes("not supported")) {
    return {
      code: "WINDOWS_SANDBOX_UNSUPPORTED_MODE",
      message: normalized,
      retryable: false
    };
  }

  return {
    code: "WINDOWS_SANDBOX_SETUP_FAILED",
    message: normalized,
    retryable: true
  };
}

export class WindowsSandboxSetupService {
  private readonly logger: Logger;

  constructor(
    private readonly options: {
      codexHomeDir: string;
      workspaceDir?: string;
      codexCommand?: string;
      logger?: Logger;
      spawnImpl?: typeof spawn;
      platform?: NodeJS.Platform;
    }
  ) {
    this.logger = options.logger ?? createLogger("windows-sandbox-setup");
  }

  async runSetup(mode: Exclude<WindowsSandboxMode, "off">): Promise<WindowsSandboxSetupResult> {
    if ((this.options.platform ?? process.platform) !== "win32") {
      return {
        ok: false,
        error: {
          code: "WINDOWS_SANDBOX_UNSUPPORTED_MODE",
          message: "Windows sandbox は Windows でのみ利用できます。",
          retryable: false
        }
      };
    }

    const client = new CodexAppServerClient({
      codexHomeDir: this.options.codexHomeDir,
      codexCommand: this.options.codexCommand,
      logger: this.logger,
      spawnImpl: this.options.spawnImpl
    });

    try {
      const cwd = normalizeWorkingDirectory(this.options.workspaceDir ?? process.cwd(), this.options.platform);
      const response = await client.request<{ started?: boolean }>("windowsSandbox/setupStart", { mode, cwd });
      if (!response?.started) {
        return {
          ok: false,
          error: {
            code: "WINDOWS_SANDBOX_SETUP_FAILED",
            message: "Windows sandbox セットアップを開始できませんでした。",
            retryable: true
          }
        };
      }

      const completion = await client.waitForNotification<WindowsSandboxSetupCompletedNotification>(
        "windowsSandbox/setupCompleted",
        {
          predicate: (params) => params.mode === mode,
          timeoutMs: 120000
        }
      );

      if (completion.success) {
        return {
          ok: true,
          mode,
          message: mode === "elevated"
            ? "Windows sandbox を elevated モードで利用できるようにしました。"
            : "Windows sandbox を unelevated モードで利用できるようにしました。"
        };
      }

      return { ok: false, error: toSetupError(completion.error ?? "Windows sandbox のセットアップに失敗しました。") };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("windows_sandbox_setup_failed", { mode, message });
      return { ok: false, error: toSetupError(message) };
    } finally {
      client.close();
    }
  }
}