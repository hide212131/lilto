const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// A disposable Codex rollout; no model requests or real user history required.
function seedHistory(codexHome, cwd, count = 1000) {
  const id = randomUUID();
  const timestamp = "2026-11-04T01:00:00.000Z";
  const dir = path.join(codexHome, "sessions", "2026", "11", "04");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-11-04T01-00-00-${id}.jsonl`);
  const lines = [{ timestamp, type: "session_meta", payload: {
    id, timestamp, cwd, originator: "lilto", cli_version: "0.163.0", source: "vscode", model_provider: "openai"
  } }];
  for (let i = 0; i < count; i += 1) {
    const time = new Date(Date.parse(timestamp) + i * 10000).toISOString();
    for (const payload of [
      { type: "task_started", turn_id: `turn-${i}`, model_context_window: 128000 },
      { type: "user_message", message: `History question ${i}`, images: [], local_images: [], text_elements: [] },
      { type: "agent_message", message: `History answer ${i}`, phase: "final_answer" },
      { type: "task_complete", turn_id: `turn-${i}`, last_agent_message: `History answer ${i}` }
    ]) lines.push({ timestamp: time, type: "event_msg", payload });
  }
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return id;
}

module.exports = { seedHistory };
