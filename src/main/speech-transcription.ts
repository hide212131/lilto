import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AudioTranscriptionResult } from "../shared/audio-transcription";

const execFileAsync = promisify(execFile);
type ExecRunner = (command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

type SpeechTranscriptionServiceOptions = {
  platform?: NodeJS.Platform;
  execImpl?: ExecRunner;
  helperAppPath?: string;
};

type HelperResponse =
  | { ok: true; text: string }
  | { ok: false; code: string; message: string; retryable?: boolean };

export class SpeechTranscriptionService {
  private readonly platform: NodeJS.Platform;

  private readonly execImpl: ExecRunner;

  private readonly helperAppPath: string;

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
          message: "録音データが空です。",
          retryable: false
        }
      };
    }

    if (this.platform !== "darwin") {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_PLATFORM",
          message: `この OS (${this.platform}) では音声文字起こしに未対応です。`,
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
          message: "Speech helper が見つかりません。`npm run build:native` を実行してください。",
          retryable: true
        }
      };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lilto-speech-"));
    const audioPath = path.join(tempDir, "input.wav");
    const stdoutPath = path.join(tempDir, "stdout.json");
    const stderrPath = path.join(tempDir, "stderr.log");
    try {
      await fs.writeFile(audioPath, audioData);
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
      const helperStdout = await fs.readFile(stdoutPath, "utf8").catch(() => stdout);
      const helperStderr = await fs.readFile(stderrPath, "utf8").catch(() => stderr);
      if (helperStderr.trim()) {
        return {
          ok: false,
          error: {
            code: "TRANSCRIPTION_FAILED",
            message: helperStderr.trim(),
            retryable: true
          }
        };
      }
      const parsed = parseHelperResponse(helperStdout);
      if (parsed.ok) {
        return parsed;
      }
      return {
        ok: false,
        error: {
          code: "TRANSCRIPTION_FAILED",
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
}

function defaultExecRunner(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, [...args]);
}

function defaultHelperAppPath(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return path.join(
      process.cwd(),
      "native",
      "speech-transcriber",
      "bin",
      "speech-transcriber.app"
    );
  }
  const binaryName = platform === "win32" ? "speech-transcriber.exe" : "speech-transcriber";
  return path.join(process.cwd(), "native", "speech-transcriber", "bin", binaryName);
}

function parseHelperResponse(stdout: string): HelperResponse {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "EMPTY_RESPONSE",
      message: "Speech helper から応答がありませんでした。",
      retryable: true
    };
  }

  try {
    return JSON.parse(trimmed) as HelperResponse;
  } catch {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: `Speech helper の応答を解析できませんでした: ${trimmed}`,
      retryable: true
    };
  }
}
