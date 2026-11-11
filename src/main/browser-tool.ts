import { BrowserError, type BrowserResult } from "../shared/browser";
import { validateToolArguments, type BrowserToolName } from "./browser-tool-contract";
import type { BrowserRunHandle, EmbeddedBrowserController } from "./embedded-browser";

/** Maps a validated MCP tool call onto the controller. Never trusts caller-supplied identity. */
export async function executeBrowserTool(
  controller: EmbeddedBrowserController,
  run: BrowserRunHandle,
  tool: BrowserToolName,
  rawArgs: unknown
): Promise<BrowserResult<unknown>> {
  const validated = validateToolArguments(tool, rawArgs);
  if (!validated.ok) {
    return { ok: false, error: { code: "INTERNAL_ERROR", message: `invalid arguments: ${validated.message}`, retryable: false, effect: "none" } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = validated.args as any; // shape verified by validateToolArguments
  try {
    switch (tool) {
      case "browser_status": return controller.status();
      case "browser_acquire": return await controller.acquire(run, a);
      case "browser_release": return await controller.release(run, a);
      case "browser_navigate": return await controller.navigate(run, a);
      case "browser_back": return await controller.back(run, a);
      case "browser_forward": return await controller.forward(run, a);
      case "browser_reload": return await controller.reload(run, a);
      case "browser_snapshot": return await controller.snapshot(run, a);
      case "browser_click": return await controller.click(run, a);
      case "browser_fill": return await controller.fill(run, a);
      case "browser_select": return await controller.select(run, a);
      case "browser_press": return await controller.press(run, a);
      case "browser_scroll": return await controller.scroll(run, a);
      case "browser_get_text": return await controller.getText(run, a);
      case "browser_screenshot": return await controller.screenshot(run, a);
      case "browser_wait": return await controller.wait(run, a);
      case "browser_evaluate": return await controller.evaluate(run, a);
    }
  } catch (error) {
    const e = error instanceof BrowserError ? error.toJSON() : { code: "INTERNAL_ERROR" as const, message: "Unexpected error", retryable: false, effect: "none" as const };
    return { ok: false, error: e };
  }
}
