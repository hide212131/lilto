import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { stripSchedulerPromptGuidance } from "./agent-sdk-config";
import { createLogger } from "./logger";

const logger = createLogger("conversations");

function timestampKey(turnId: string, role: string, text: string): string {
  return JSON.stringify([turnId, role, text]);
}

// App Server preserves turn/item order but omits the persisted event timestamps.
// Read only the events it uses to build visible messages, not response_item
// duplicates or model context. Match within turns so repeated prompts stay distinct.
export async function readRolloutTimestamps(rolloutPath: unknown): Promise<(turnId: string, role: string, text: string) => number | undefined> {
  const timestamps = new Map<string, number[]>();
  if (typeof rolloutPath === "string" && rolloutPath) {
    const input = createReadStream(rolloutPath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let turnId = "";
    try {
      for await (const line of lines) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          // A running thread can have a partially written final line.
          continue;
        }
        if (entry?.type === "turn_context" && typeof entry.payload?.turn_id === "string") {
          turnId = entry.payload.turn_id;
        }
        if (entry?.type !== "event_msg" || !entry.payload) continue;
        const event = entry.payload;
        if (["task_started", "turn_started"].includes(event.type)) {
          turnId = typeof event.turn_id === "string" ? event.turn_id : "";
        }
        const role = event.type === "user_message" ? "user" : event.type === "agent_message" ? "assistant" : event.type === "error" ? "error" : undefined;
        if (!role || typeof event.message !== "string") continue;
        const createdAt = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
        if (!Number.isFinite(createdAt)) continue;
        const text = role === "user" ? stripSchedulerPromptGuidance(event.message) : event.message;
        const key = timestampKey(turnId, role, text);
        const values = timestamps.get(key) ?? [];
        values.push(createdAt);
        timestamps.set(key, values);
      }
    } catch (error) {
      // Missing/unreadable rollout files must not prevent opening API history.
      logger.error("rollout_timestamps_unavailable", {
        code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN"
      });
    } finally {
      lines.close();
      input.destroy();
    }
  }
  return (turnId, role, text) => {
    const values = timestamps.get(timestampKey(turnId, role, text))
      ?? timestamps.get(timestampKey("", role, text));
    return values?.shift();
  };
}
