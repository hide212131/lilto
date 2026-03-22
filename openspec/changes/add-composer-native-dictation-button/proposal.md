## Why

The composer already supports keyboard-first prompting, but short dictated prompts are still faster for many users. We want the microphone button to behave consistently across desktop platforms instead of stopping at the macOS implementation.

## What Changes

- Keep the existing press-and-hold composer microphone UI.
- Record audio in the renderer and continue sending WAV data through the preload/main bridge.
- Use the existing macOS Speech helper on macOS.
- Add a Windows native dictation path using a Rust helper with `Windows.Media.SpeechRecognition`.
- Surface transcription failures in the composer status area without sending or overwriting text.

## Capabilities

### Modified Capabilities

- `renderer-chat-ui`: the composer microphone flow now supports both macOS and Windows native transcription paths.

## Impact

- Renderer composer audio capture and feedback UI.
- Main-process speech transcription service.
- Native helper assets for Windows.
- Verification docs and tests for cross-platform behavior.
