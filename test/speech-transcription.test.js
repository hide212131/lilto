const test = require("node:test");
const assert = require("node:assert/strict");

const { SpeechTranscriptionService } = require("../dist/main/speech-transcription.js");

test("SpeechTranscriptionService returns unsupported for non-macOS/non-Windows platforms", async () => {
  const service = new SpeechTranscriptionService({ platform: "linux" });
  const result = await service.transcribeWav(new Uint8Array([1, 2, 3]));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNSUPPORTED_PLATFORM");
});

test("SpeechTranscriptionService returns unsupported when WAV transcription is used on Windows", async () => {
  const service = new SpeechTranscriptionService({
    platform: "win32",
    helperAppPath: "C:\\missing\\speech-transcriber.exe"
  });
  const result = await service.transcribeWav(new Uint8Array([1, 2, 3]));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNSUPPORTED_PLATFORM");
});

test("SpeechTranscriptionService returns unavailable when the Windows native helper is missing", async () => {
  const service = new SpeechTranscriptionService({
    platform: "win32",
    helperAppPath: "C:\\missing\\speech-transcriber.exe"
  });
  const result = await service.startNativeDictation();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SERVICE_UNAVAILABLE");
});

test("SpeechTranscriptionService reads a successful macOS helper response", async () => {
  const service = new SpeechTranscriptionService({
    platform: "darwin",
    helperAppPath: __filename,
    execImpl: async () => ({ stdout: JSON.stringify({ ok: true, text: "hello" }), stderr: "" })
  });

  const result = await service.transcribeWav(new Uint8Array([1, 2, 3]));
  assert.deepEqual(result, { ok: true, text: "hello" });
});

test("SpeechTranscriptionService returns a session error when finishNativeDictation is called without a start", async () => {
  const service = new SpeechTranscriptionService({
    platform: "win32",
    helperAppPath: __filename
  });

  const result = await service.finishNativeDictation();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TRANSCRIPTION_FAILED");
});

test("SpeechTranscriptionService preserves Windows speech privacy errors with actionable guidance", async () => {
  const service = new SpeechTranscriptionService({
    platform: "win32",
    helperAppPath: __filename
  });

  service.liveSession = {
    child: { stdin: { end() {} }, kill() {} },
    stdout: "",
    stderr: "",
    exitPromise: Promise.resolve({
      stdout: JSON.stringify({
        ok: false,
        code: "SPEECH_PRIVACY_NOT_ACCEPTED",
        message: "Enable Speech privacy in Windows Settings.",
        retryable: false
      }),
      stderr: "",
      exitCode: 0
    })
  };

  const result = await service.finishNativeDictation();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SPEECH_PRIVACY_NOT_ACCEPTED");
  assert.equal(result.error.retryable, false);
});

test("SpeechTranscriptionService closes helper stdin before waiting for Windows dictation results", async () => {
  let ended = false;
  const service = new SpeechTranscriptionService({
    platform: "win32",
    helperAppPath: __filename
  });

  service.liveSession = {
    child: { stdin: { end() { ended = true; } }, kill() {} },
    stdout: "",
    stderr: "",
    exitPromise: Promise.resolve({
      stdout: JSON.stringify({ ok: true, text: "hello world" }),
      stderr: "",
      exitCode: 0
    })
  };

  const result = await service.finishNativeDictation();
  assert.equal(ended, true);
  assert.deepEqual(result, { ok: true, text: "hello world" });
});
