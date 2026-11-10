import { BROWSER_DEVELOPER_INSTRUCTIONS, type BrowserMcpLaunch } from "./agent-sdk-config";
import type { BrowserBridgeServer } from "./browser-bridge";
import type { EmbeddedBrowserController } from "./embedded-browser";

export type BrowserRunLease = { launch: BrowserMcpLaunch; developerInstructions: string; end(): void };

export type BrowserRunSupport = {
  /** Issues a run capability, or null when the browser is OFF/unavailable for this run. */
  begin(input: { conversationId: string; requestId: string }): BrowserRunLease | null;
  /** Revoke everything and wait until in-flight work can no longer touch the browser. */
  revokeAll(): void;
};

export function createBrowserRunSupport(options: {
  controller: EmbeddedBrowserController;
  bridge: BrowserBridgeServer;
  serverPath: () => string;
  execPath?: string;
}): BrowserRunSupport {
  return {
    begin({ conversationId, requestId }) {
      if (!options.controller.isEnabled() || !options.bridge.isRunning) return null;
      let context;
      try {
        context = options.controller.issueRun({ conversationId, requestId, policyRevision: options.controller.getPolicyRevision() });
      } catch {
        return null;
      }
      const launch: BrowserMcpLaunch = {
        command: options.execPath ?? process.execPath,
        args: [options.serverPath()],
        env: options.bridge.getRunEnv(context)
      };
      return {
        launch,
        developerInstructions: BROWSER_DEVELOPER_INSTRUCTIONS,
        end: () => options.controller.ownership.revokeRun(context.runId)
      };
    },
    revokeAll() {
      options.controller.ownership.revokeAllRuns();
    }
  };
}
