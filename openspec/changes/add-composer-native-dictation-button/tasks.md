## 1. Audio capture and transcription bridge

- [x] 1.1 Add preload and IPC wiring for audio transcription requests.
- [x] 1.2 Add `SpeechTranscriptionService` in the main process and pass WAV payloads to a native helper.
- [x] 1.3 Implement the macOS helper with the Speech framework.
- [x] 1.4 Implement the Windows path with a Rust helper using `Windows.Media.SpeechRecognition`.

## 2. Composer UI and interaction

- [x] 2.1 Add a microphone button next to the composer send action.
- [x] 2.2 Show recording/transcribing feedback and cancel on pointer cancel or window blur.
- [x] 2.3 Append successful transcription text into the textarea and keep failures non-destructive.

## 3. Verification

- [x] 3.1 Cover the renderer/main bridge and platform-specific transcription service behavior with tests.
- [ ] 3.2 Run `/live-ui-manual-verification` for macOS and Windows dictation behavior.
- [ ] 3.3 Run `npm run e2e:electron` and confirm `test/artifacts/electron-e2e.png`.
