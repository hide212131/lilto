export type AudioTranscriptionErrorCode =
  | "UNSUPPORTED_PLATFORM"
  | "MIC_PERMISSION_DENIED"
  | "RECORDING_FAILED"
  | "TRANSCRIPTION_FAILED"
  | "EMPTY_AUDIO"
  | "SERVICE_UNAVAILABLE";

export type AudioTranscriptionResult =
  | { ok: true; text: string }
  | {
      ok: false;
      error: {
        code: AudioTranscriptionErrorCode;
        message: string;
        retryable: boolean;
      };
    };
