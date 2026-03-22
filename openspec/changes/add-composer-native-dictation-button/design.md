## Context

The renderer already records microphone audio and sends a WAV payload to the main process on macOS. macOS transcription is implemented through a small Speech-framework helper app. Windows needs a higher-quality local dictation path, and `Windows.Media.SpeechRecognition` is a better fit than the legacy `System.Speech` engine.

## Goals

- Keep the same press-and-hold composer interaction on both platforms.
- Preserve renderer-side recording and waveform/status feedback where it is the right platform fit.
- Use Windows native microphone dictation directly for better recognition quality.
- Keep failures non-destructive: show an error, leave the composer text alone, and do not send automatically.

## Non-Goals

- Reusing the OS dictation UI.
- Introducing a cloud transcription dependency.
- Changing the composer send flow or auto-submit behavior.

## Decisions

### 1. Renderer continues to own capture

The renderer still starts/stops recording on `pointerdown` / `pointerup` and converts the captured audio to WAV before IPC. This keeps permission prompts and input feedback close to the UI.

### 2. `SpeechTranscriptionService` stays the single bridge

The main process keeps one service that accepts WAV bytes and delegates to a platform-specific helper:

- macOS: launch the existing Speech helper app and read JSON output.
- Windows: manage a Rust helper process that uses `Windows.Media.SpeechRecognition` against the system microphone.

### 3. Windows helper is compiled in Rust for better engine access

We introduce a small Rust executable on Windows so we can call the WinRT speech APIs directly. This is a better quality ceiling than the old PowerShell + `System.Speech` route and fits the existing native build pipeline.

### 4. Platform-specific failures map cleanly to UI-facing errors

- Unsupported platforms still return `UNSUPPORTED_PLATFORM`.
- Missing Windows speech language/components map to `SERVICE_UNAVAILABLE`.
- Recognition/runtime failures map to `TRANSCRIPTION_FAILED`.

## Risks / Trade-offs

- Windows speech language availability still depends on the user's installed speech packs.
- Recognition quality may differ from macOS because the engines are different.
- The compiled helper needs Windows build tools present when building locally.

## Migration Plan

- Keep the existing renderer and IPC contract.
- Extend the main transcription service for Windows native live dictation.
- Add tests that cover the new Windows dictation IPC surface and missing-helper behavior.
- Update the OpenSpec artifacts and manual verification notes to reflect Windows support.

## Open Questions

- Whether we want locale selection for Windows speech recognition in a follow-up.
- Whether packaged Windows builds should eventually replace the PowerShell helper with a native binary.
