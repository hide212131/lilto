import type { Logger } from "./logger";
import type { BrowserSettings } from "../shared/provider-settings";
import type { EmbeddedBrowserController } from "./embedded-browser";

/**
 * Orders a browser-setting change so nothing keeps a stale tool/skill configuration
 * (design 11.4): stop issuing -> revoke -> stop runs/clients -> skill policy -> save -> migrate.
 */
export function createBrowserSettingsFlow(deps: {
  controller: EmbeddedBrowserController;
  bridge: { start(): Promise<void>; stop(): void };
  stopAllRuns: () => Promise<void>;
  syncSkillPolicy: (browserEnabled: boolean) => void;
  logger: Logger;
}) {
  return {
    /** Steps 2-6. Throws when the skill policy cannot be synced; the feature then stays stopped. */
    async prepare(next: BrowserSettings, current: BrowserSettings): Promise<void> {
      if (next.enabled === current.enabled) return;
      deps.controller.ownership.setIssuing(false);
      deps.controller.ownership.revokeAllRuns();
      deps.bridge.stop();
      await deps.stopAllRuns();
      deps.syncSkillPolicy(next.enabled);
    },
    /** Step 7 (after the settings file was written). */
    async commit(next: BrowserSettings): Promise<void> {
      await deps.controller.applySettings(next);
      if (next.enabled) {
        // A bridge that cannot start means no MCP registration; surface it instead of failing silently.
        await deps.bridge.start().catch((error: unknown) => {
          deps.logger.error("browser_bridge_start_failed", { message: error instanceof Error ? error.message : String(error) });
        });
      }
    },
    /** Persisting failed: keep the browser stopped rather than run with unknown settings. */
    async failSafe(): Promise<void> {
      deps.logger.error("browser_settings_apply_failed");
      deps.bridge.stop();
      await deps.controller.applySettings({ enabled: false, autoOpenOnToolUse: false });
    }
  };
}

export type BrowserSettingsFlow = ReturnType<typeof createBrowserSettingsFlow>;
