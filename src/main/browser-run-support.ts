import { resolveBrowserInstructionUpdate, type BrowserInstructionUpdate, type BrowserMcpLaunch } from "./agent-sdk-config";
import type { BrowserBridgeServer } from "./browser-bridge";
import type { EmbeddedBrowserController } from "./embedded-browser";

/**
 * What a managed run may do with the embedded browser right now.
 * - off: integration disabled. No capability, but the model must still be told (see `update`).
 * - on: capability issued; `end()` revokes it.
 * - unavailable: the setting is ON (or being changed) but no capability can be issued. This is NOT "off":
 *   the run must fail without a turn, or the model could be steered onto an external browser.
 */
export type BrowserRunDecision =
  | { kind: "off"; update: BrowserInstructionUpdate }
  | { kind: "on"; update: BrowserInstructionUpdate; launch: BrowserMcpLaunch; end(): void }
  | { kind: "unavailable"; reason: "settings-changing" | "issue-failed" };

export type BrowserRunLease = { launch: BrowserMcpLaunch; end(): void };

export type BrowserRunSupport = {
  /** Capability only: a lease when ON and issuable, otherwise null. Null does NOT mean OFF; use resolve() for that. */
  begin(input: { conversationId: string; requestId: string }): BrowserRunLease | null;
  /** Resolves the effective setting for one managed run and issues its capability when ON. */
  resolve(input: { conversationId: string; requestId: string }): BrowserRunDecision;
  /** Changes whenever ON/OFF or evaluate changes; lets a run detect a setting change while it was preparing. */
  policyRevision(): number;
  /** Revoke everything and wait until in-flight work can no longer touch the browser. */
  revokeAll(): void;
};

export function createBrowserRunSupport(options: {
  controller: EmbeddedBrowserController;
  bridge: BrowserBridgeServer;
  serverPath: () => string;
  execPath?: string;
  /** True from the moment a permission change stops issuing until it is applied (or rolled back). */
  isSettingsChanging?: () => boolean;
}): BrowserRunSupport {
  const support: BrowserRunSupport = {
    begin(input) {
      const decision = support.resolve(input);
      return decision.kind === "on" ? { launch: decision.launch, end: decision.end } : null;
    },
    resolve({ conversationId, requestId }) {
      if (options.isSettingsChanging?.()) return { kind: "unavailable", reason: "settings-changing" };
      const enabled = options.controller.isEnabled();
      const evaluateEnabled = options.controller.isEvaluateEnabled();
      const update = resolveBrowserInstructionUpdate({ enabled, evaluateEnabled });
      if (!enabled) return { kind: "off", update };
      if (!options.bridge.isRunning) return { kind: "unavailable", reason: "issue-failed" };
      let context;
      try {
        context = options.controller.issueRun({ conversationId, requestId, policyRevision: options.controller.getPolicyRevision() });
      } catch {
        return { kind: "unavailable", reason: "issue-failed" };
      }
      const launch: BrowserMcpLaunch = {
        command: options.execPath ?? process.execPath,
        args: [options.serverPath()],
        env: options.bridge.getRunEnv(context, { evaluateEnabled })
      };
      return { kind: "on", update, launch, end: () => options.controller.ownership.revokeRun(context.runId) };
    },
    policyRevision: () => options.controller.getPolicyRevision(),
    revokeAll() {
      options.controller.ownership.revokeAllRuns();
    }
  };
  return support;
}
