/**
 * The recording Responses server in its OWN process (forked by instruction-lifecycle-lab with recorderProcess: true),
 * so that stalling the Electron main process under test does not also stall the server that timestamps its requests.
 * Protocol (process IPC):
 *   child -> parent  {type:"ready", port} | {type:"request", rec} | {type:"pong", id}
 *   parent -> child  {cmd:"state", key, value} | {cmd:"ping", id} | {cmd:"close"}
 * `scriptSpec` replaces the function-valued `state.script`: {toolCallNeedle} makes the model call exec_command once
 * the last user message contains the needle; {refusalNeedle, text} answers with a fixed text.
 */
const { startRecorder } = require("./compaction-probe-lib.js");

(async () => {
  const timeline = [];
  const recorder = await startRecorder(timeline, {
    onRequest: (rec) => process.send({ type: "request", rec: { seq: rec.seq, t: rec.t, wall: Date.now(), kind: rec.kind, url: rec.url, body: rec.body } })
  });
  recorder.state.script = (rec) => {
    const spec = recorder.state.scriptSpec;
    if (!spec) return null;
    const input = rec.body?.input ?? []; const last = input[input.length - 1] ?? {};
    const text = Array.isArray(last.content) ? last.content.map((c) => c.text ?? "").join("") : "";
    if (spec.toolCallNeedle && last.role === "user" && text.includes(spec.toolCallNeedle)) return { toolCall: { name: "exec_command", args: { cmd: "echo mid-turn-tool", yield_time_ms: 1000 } } };
    if (spec.refusalNeedle && text.includes(spec.refusalNeedle)) return { text: spec.text };
    return null;
  };
  process.on("message", (m) => {
    if (m.cmd === "state") recorder.state[m.key] = m.value;
    else if (m.cmd === "ping") process.send({ type: "pong", id: m.id });
    else if (m.cmd === "close") { recorder.close(); process.exit(0); }
  });
  process.on("disconnect", () => process.exit(0));
  process.send({ type: "ready", port: recorder.port });
})();
