const test = require("node:test");
const assert = require("node:assert/strict");

const { SpeechTranscriptionService } = require("../dist/main/speech-transcription.js");

test("SpeechTranscriptionService は未対応 OS を明示エラーにする", async () => {
  const service = new SpeechTranscriptionService({ platform: "win32" });
  const result = await service.transcribeWav(new Uint8Array([1, 2, 3]));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNSUPPORTED_PLATFORM");
});

test("SpeechTranscriptionService は helper 応答を成功として返す", async () => {
  const service = new SpeechTranscriptionService({
    platform: "darwin",
    helperAppPath: __filename,
    execImpl: async () => ({ stdout: JSON.stringify({ ok: true, text: "hello" }), stderr: "" })
  });

  const result = await service.transcribeWav(new Uint8Array([1, 2, 3]));
  assert.deepEqual(result, { ok: true, text: "hello" });
});
