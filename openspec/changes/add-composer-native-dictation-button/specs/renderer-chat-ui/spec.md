## ADDED Requirements

### Requirement: Composer supports press-and-hold dictation

The system MUST show a microphone button next to the composer send action. While the user is pressing the button, the UI MUST show recording feedback. When the user releases the button after a successful capture and transcription, the recognized text MUST be appended to the composer textarea without auto-sending.

#### Scenario: Recording state is visible while dictation is active
- **WHEN** the user presses and holds the composer microphone button
- **THEN** the composer shows an active recording/transcribing state and audio-level feedback

#### Scenario: Successful transcription appends into the composer
- **WHEN** the user releases the microphone button and the transcription succeeds
- **THEN** the recognized text is appended to the existing textarea value and focus returns to the composer

### Requirement: Dictation failures do not break normal composer behavior

The system MUST keep composer text intact when transcription fails or is unavailable, and it MUST show an error message in the dictation status area instead of sending the prompt.

#### Scenario: Platform helper fails or is unavailable
- **WHEN** the main process returns `UNSUPPORTED_PLATFORM`, `SERVICE_UNAVAILABLE`, or another dictation failure
- **THEN** the composer shows the failure in the dictation status area and leaves textarea content and send behavior unchanged
