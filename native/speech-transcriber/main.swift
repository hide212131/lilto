import Foundation
import Speech

struct SuccessResponse: Encodable {
    let ok = true
    let text: String
}

struct ErrorResponse: Encodable {
    let ok = false
    let code: String
    let message: String
    let retryable: Bool
}

func emitJSON<T: Encodable>(_ value: T) -> Never {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(value) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
    exit(0)
}

func emitError(code: String, message: String, retryable: Bool = true) -> Never {
    emitJSON(ErrorResponse(code: code, message: message, retryable: retryable))
}

func waitUntil(timeout: TimeInterval, poll: TimeInterval = 0.05, condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() {
            return true
        }
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(poll))
    }
    return condition()
}

guard CommandLine.arguments.count >= 2 else {
    emitError(code: "INVALID_ARGUMENTS", message: "audio file path is required", retryable: false)
}

let audioPath = CommandLine.arguments[1]
let audioURL = URL(fileURLWithPath: audioPath)

guard FileManager.default.fileExists(atPath: audioPath) else {
    emitError(code: "FILE_NOT_FOUND", message: "audio file not found", retryable: false)
}

let currentStatus = SFSpeechRecognizer.authorizationStatus()
var authStatus = currentStatus

if currentStatus == .notDetermined {
    var authResolved = false
    SFSpeechRecognizer.requestAuthorization { status in
        authStatus = status
        authResolved = true
    }
    guard waitUntil(timeout: 10, condition: { authResolved }) else {
        emitError(code: "AUTH_TIMEOUT", message: "Speech recognition authorization timed out.", retryable: true)
    }
}

switch authStatus {
case .authorized:
    break
case .denied:
    emitError(code: "AUTH_DENIED", message: "Speech recognition permission was denied.", retryable: true)
case .restricted:
    emitError(code: "AUTH_RESTRICTED", message: "Speech recognition is restricted on this device.", retryable: false)
case .notDetermined:
    emitError(code: "AUTH_TIMEOUT", message: "Speech recognition authorization timed out.", retryable: true)
@unknown default:
    emitError(code: "AUTH_UNKNOWN", message: "Unknown speech recognition authorization state.", retryable: true)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
    emitError(code: "RECOGNIZER_UNAVAILABLE", message: "Speech recognizer is unavailable.", retryable: true)
}

let request = SFSpeechURLRecognitionRequest(url: audioURL)
request.shouldReportPartialResults = false
request.requiresOnDeviceRecognition = false

var finalText: String?
var finalError: Error?
var finished = false

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result, result.isFinal {
        finalText = result.bestTranscription.formattedString
        finished = true
        return
    }
    if let error {
        finalError = error
        finished = true
    }
}

guard waitUntil(timeout: 30, condition: { finished }) else {
    task.cancel()
    emitError(code: "TRANSCRIPTION_TIMEOUT", message: "Speech recognition timed out.", retryable: true)
}

task.cancel()

if let text = finalText?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
    emitJSON(SuccessResponse(text: text))
}

if let error = finalError {
    emitError(code: "TRANSCRIPTION_FAILED", message: error.localizedDescription, retryable: true)
}

emitError(code: "NO_RESULT", message: "Speech recognition completed without text.", retryable: true)
