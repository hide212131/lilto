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
  // True from the first stop-issuing step until the new settings are applied or rolled back.
  let applying = false;
  return {
    /** New browser runs must not start while a permission change is half-applied. */
    isApplying: () => applying,
    /** Steps 2-6. Throws when the skill policy cannot be synced; the feature then stays stopped. */
    async prepare(next: BrowserSettings, current: BrowserSettings): Promise<void> {
      const enabledChanged = next.enabled !== current.enabled;
      // Turning page-JS on/off changes what a run may do just like ON/OFF does: no run may keep the old tool set.
      if (!enabledChanged && next.evaluateEnabled === current.evaluateEnabled) return;
      applying = true;
      deps.controller.ownership.setIssuing(false);
      deps.controller.ownership.revokeAllRuns();
      deps.bridge.stop();
      await deps.stopAllRuns();
      // The agent-browser skill policy only depends on the browser being ON; evaluate-only changes leave it alone.
      if (enabledChanged) deps.syncSkillPolicy(next.enabled);
    },
    /** Step 7 (after the settings file was written). */
    async commit(next: BrowserSettings): Promise<void> {
      try {
        await deps.controller.applySettings(next);
        if (next.enabled) {
          // A bridge that cannot start means no MCP registration; surface it instead of failing silently.
          await deps.bridge.start().catch((error: unknown) => {
            deps.logger.error("browser_bridge_start_failed", { message: error instanceof Error ? error.message : String(error) });
          });
        }
      } finally {
        applying = false;
      }
    },
    /** Persisting failed: keep the browser stopped rather than run with unknown settings. */
    async failSafe(): Promise<void> {
      deps.logger.error("browser_settings_apply_failed");
      try {
        deps.bridge.stop();
        await deps.controller.applySettings({ enabled: false, autoOpenOnToolUse: false, evaluateEnabled: false });
      } finally {
        applying = false;
      }
    }
  };
}

export type BrowserSettingsFlow = ReturnType<typeof createBrowserSettingsFlow>;
