import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type { AudioTranscriptionResult } from "../shared/audio-transcription";

const execFileAsync = promisify(execFile);
type ExecRunner = (command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

type SpeechTranscriptionServiceOptions = {
  platform?: NodeJS.Platform;
  execImpl?: ExecRunner;
  helperAppPath?: string;
};

type AudioTranscriptionError = Extract<AudioTranscriptionResult, { ok: false }>["error"];

type HelperResponse =
  | { ok: true; text: string }
  | { ok: false; code: string; message: string; retryable?: boolean };

export class SpeechTranscriptionService {
  private readonly platform: NodeJS.Platform;

  private readonly execImpl: ExecRunner;

  private readonly helperAppPath: string;

  private liveSession: {
    child: ChildProcessWithoutNullStreams;
    stdout: string;
    stderr: string;
    exitPromise: Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  } | null = null;

  constructor(options: SpeechTranscriptionServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.execImpl = options.execImpl ?? defaultExecRunner;
    this.helperAppPath = options.helperAppPath ?? defaultHelperAppPath(this.platform);
  }

  async transcribeWav(audioData: Uint8Array): Promise<AudioTranscriptionResult> {
    if (audioData.byteLength === 0) {
      return {
        ok: false,
        error: {
          code: "EMPTY_AUDIO",
          message: "Audio data is empty.",
          retryable: false
        }
      };
    }

    if (this.platform !== "darwin") {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_PLATFORM",
          message: `WAV transcription is not supported on ${this.platform}.`,
          retryable: false
        }
      };
    }

    try {
      await fs.access(this.helperAppPath);
    } catch {
      return {
        ok: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Speech transcription helper is not available. Run `npm run build:native` first.",
          retryable: true
        }
      };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lilto-speech-"));
    const audioPath = path.join(tempDir, "input.wav");
    try {
      await fs.writeFile(audioPath, audioData);
      const helperOutput = await this.runHelper(audioPath, tempDir);
      if (!helperOutput.ok) {
        return helperOutput.result;
      }

      if (helperOutput.stderr.trim()) {
        return {
          ok: false,
          error: {
            code: "TRANSCRIPTION_FAILED",
            message: helperOutput.stderr.trim(),
            retryable: true
          }
        };
      }

      const parsed = parseHelperResponse(helperOutput.stdout);
      if (parsed.ok) {
        return parsed;
      }

      return {
        ok: false,
        error: {
          code: normalizeHelperErrorCode(parsed.code),
          message: parsed.message,
          retryable: parsed.retryable ?? true
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          code: "TRANSCRIPTION_FAILED",
          message,
          retryable: true
        }
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async runHelper(
    audioPath: string,
    tempDir: string
  ): Promise<
    | { ok: true; stdout: string; stderr: string }
    | { ok: false; result: AudioTranscriptionResult }
  > {
    if (this.platform === "darwin") {
      const stdoutPath = path.join(tempDir, "stdout.json");
      const stderrPath = path.join(tempDir, "stderr.log");
      const { stdout, stderr } = await this.execImpl("/usr/bin/open", [
        "-W",
        "-n",
        this.helperAppPath,
        "--stdout",
        stdoutPath,
        "--stderr",
        stderrPath,
        "--args",
        audioPath
      ]);

      return {
        ok: true,
        stdout: await fs.readFile(stdoutPath, "utf8").catch(() => stdout),
        stderr: await fs.readFile(stderrPath, "utf8").catch(() => stderr)
      };
    }

    return {
      ok: false,
      result: {
        ok: false,
        error: {
          code: "UNSUPPORTED_PLATFORM",
          message: `Speech transcription is not supported on ${this.platform}.`,
          retryable: false
        }
      }
    };
  }

  async startNativeDictation(): Promise<{ ok: true } | { ok: false; error: AudioTranscriptionError }> {
    if (this.platform !== "win32") {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_PLATFORM",
          message: `Native dictation is not supported on ${this.platform}.`,
          retryable: false
        }
      };
    }

    if (this.liveSession) {
      return {
        ok: false,
        error: {
          code: "TRANSCRIPTION_FAILED",
          message: "A dictation session is already active.",
          retryable: true
        }
      };
    }

    try {
      await fs.access(this.helperAppPath);
    } catch {
      return {
        ok: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Windows native dictation helper is not available. Run `npm run build:native` first.",
          retryable: true
        }
      };
    }

    const child = spawn(this.helperAppPath, [], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exitPromise = new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });
    });

    this.liveSession = { child, stdout, stderr, exitPromise };
    return { ok: true };
  }

  async finishNativeDictation(): Promise<AudioTranscriptionResult> {
    if (!this.liveSession) {
      return {
        ok: false,
        error: {
          code: "TRANSCRIPTION_FAILED",
          message: "No active dictation session.",
          retryable: true
        }
      };
    }

    const session = this.liveSession;
    this.liveSession = null;

    try {
      session.child.stdin.end();
      const result = await session.exitPromise;
      if (result.exitCode && result.exitCode !== 0 && !result.stdout.trim()) {
        return {
          ok: false,
          error: {
            code: "TRANSCRIPTION_FAILED",
            message: result.stderr.trim() || `Native dictation helper exited with code ${result.exitCode}.`,
            retryable: true
          }
        };
      }

      const parsed = parseHelperResponse(result.stdout);
      if (parsed.ok) {
        return parsed;
      }

      return {
        ok: false,
        error: {
          code: normalizeHelperErrorCode(parsed.code),
          message: parsed.message,
          retryable: parsed.retryable ?? true
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          code: "TRANSCRIPTION_FAILED",
          message,
          retryable: true
        }
      };
    }
  }

  async cancelNativeDictation(): Promise<void> {
    if (!this.liveSession) {
      return;
    }

    const session = this.liveSession;
    this.liveSession = null;
    session.child.kill();
    await session.exitPromise.catch(() => {});
  }
}

function defaultExecRunner(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, [...args]);
}

function defaultHelperAppPath(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return path.join(process.cwd(), "native", "speech-transcriber", "bin", "speech-transcriber.app");
  }
  if (platform === "win32") {
    return path.join(process.cwd(), "native", "speech-transcriber", "bin", "speech-transcriber.exe");
  }
  return path.join(process.cwd(), "native", "speech-transcriber", "bin", "speech-transcriber");
}

function parseHelperResponse(stdout: string): HelperResponse {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "EMPTY_RESPONSE",
      message: "Speech helper returned an empty response.",
      retryable: true
    };
  }

  try {
    return JSON.parse(trimmed) as HelperResponse;
  } catch {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: `Speech helper returned invalid JSON: ${trimmed}`,
      retryable: true
    };
  }
}

function normalizeHelperErrorCode(code: string): AudioTranscriptionError["code"] {
  if (code === "SYSTEM_SPEECH_UNAVAILABLE" || code === "NO_RECOGNIZER" || code === "LANGUAGE_NOT_AVAILABLE") {
    return "SERVICE_UNAVAILABLE";
  }
  if (code === "MIC_PERMISSION_DENIED" || code === "SPEECH_PRIVACY_NOT_ACCEPTED") {
    return code;
  }
  return "TRANSCRIPTION_FAILED";
}
