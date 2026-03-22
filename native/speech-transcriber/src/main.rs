use serde::Serialize;
use std::io::Read;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use windows::core::Result as WinResult;
use windows::Foundation::TypedEventHandler;
use windows::Globalization::Language;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionCompletedEventArgs, SpeechContinuousRecognitionResultGeneratedEventArgs,
    SpeechContinuousRecognitionSession, SpeechRecognitionCompilationResult, SpeechRecognitionResult,
    SpeechRecognitionResultStatus, SpeechRecognizer,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

#[derive(Serialize)]
#[serde(untagged)]
enum HelperResponse {
    Ok { ok: bool, text: String },
    Err {
        ok: bool,
        code: String,
        message: String,
        retryable: bool,
    },
}

fn main() {
    let response = match run() {
        Ok(text) => HelperResponse::Ok { ok: true, text },
        Err(error) => map_error(error),
    };

    println!("{}", serde_json::to_string(&response).unwrap_or_else(|_| {
        "{\"ok\":false,\"code\":\"SERIALIZE_FAILED\",\"message\":\"Failed to serialize helper response.\",\"retryable\":true}".to_string()
    }));
}

fn run() -> WinResult<String> {
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)?;
    }

    let recognizer = create_recognizer()?;
    let compile_result = pollster::block_on(recognizer.CompileConstraintsAsync()?)?;
    ensure_compile_success(&compile_result)?;

    let session = recognizer.ContinuousRecognitionSession()?;
    let phrases = Arc::new(Mutex::new(Vec::<String>::new()));
    let (completed_tx, completed_rx) = mpsc::channel::<WinResult<()>>();

    let result_phrases = Arc::clone(&phrases);
    let result_handler = TypedEventHandler::<
        SpeechContinuousRecognitionSession,
        SpeechContinuousRecognitionResultGeneratedEventArgs,
    >::new(move |_, args| {
        if let Some(args) = args.as_ref() {
            let result = args.Result()?;
            push_phrase(&result_phrases, &result)?;
        }
        Ok(())
    });
    session.ResultGenerated(&result_handler)?;

    let completed_handler = TypedEventHandler::<
        SpeechContinuousRecognitionSession,
        SpeechContinuousRecognitionCompletedEventArgs,
    >::new(move |_, args| {
        let status = args
            .as_ref()
            .ok_or_else(|| {
                windows::core::Error::new(
                    windows::core::HRESULT(0x80004005u32 as i32),
                    "Continuous recognition completed without event args.",
                )
            })?
            .Status()?;

        let event_result = if status == SpeechRecognitionResultStatus::Success {
            Ok(())
        } else {
            Err(windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                format!("Speech recognition failed with status {:?}", status),
            ))
        };

        let _ = completed_tx.send(event_result);
        Ok(())
    });
    session.Completed(&completed_handler)?;

    pollster::block_on(session.StartAsync()?)?;
    wait_for_stop_signal()?;
    pollster::block_on(session.StopAsync()?)?;

    match completed_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(result) => result?,
        Err(_) => {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                "Timed out while waiting for continuous recognition to stop.",
            ))
        }
    }

    let text = phrases
        .lock()
        .map_err(|_| {
            windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                "Failed to read recognized phrases.",
            )
        })?
        .join(" ")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err(windows::core::Error::new(
            windows::core::HRESULT(0x80004005u32 as i32),
            "No speech could be recognized.",
        ));
    }

    Ok(text)
}

fn wait_for_stop_signal() -> WinResult<()> {
    let mut buffer = Vec::new();
    std::io::stdin().read_to_end(&mut buffer).map_err(|error| {
        windows::core::Error::new(
            windows::core::HRESULT(0x80004005u32 as i32),
            format!("Failed to read dictation stop signal: {error}"),
        )
    })?;
    Ok(())
}

fn push_phrase(phrases: &Arc<Mutex<Vec<String>>>, result: &SpeechRecognitionResult) -> WinResult<()> {
    if result.Status()? != SpeechRecognitionResultStatus::Success {
        return Ok(());
    }

    let text = result.Text()?.to_string().trim().to_string();
    if text.is_empty() {
        return Ok(());
    }

    phrases
        .lock()
        .map_err(|_| {
            windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                "Failed to store recognized phrase.",
            )
        })?
        .push(text);
    Ok(())
}

fn create_recognizer() -> WinResult<SpeechRecognizer> {
    let system_language = SpeechRecognizer::SystemSpeechLanguage()?;
    let supported = SpeechRecognizer::SupportedTopicLanguages()?;
    let language = if language_supported(&supported, &system_language)? {
        system_language
    } else {
        supported.GetAt(0)?
    };

    SpeechRecognizer::Create(&language)
}

fn language_supported(
    supported: &windows_collections::IVectorView<Language>,
    language: &Language,
) -> WinResult<bool> {
    let target = language.LanguageTag()?.to_string();
    let size = supported.Size()?;
    for index in 0..size {
        if supported.GetAt(index)?.LanguageTag()?.to_string() == target {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_compile_success(result: &SpeechRecognitionCompilationResult) -> WinResult<()> {
    let status = result.Status()?;
    if status == SpeechRecognitionResultStatus::Success {
        return Ok(());
    }

    Err(windows::core::Error::new(
        windows::core::HRESULT(0x80004005u32 as i32),
        format!("Speech recognition compile failed with status {:?}", status),
    ))
}

fn map_error(error: windows::core::Error) -> HelperResponse {
    let message = error.message().to_string();
    let lower = message.to_ascii_lowercase();
    if lower.contains("speech privacy policy was not accepted") || lower.contains("privacy policy") {
        return HelperResponse::Err {
            ok: false,
            code: "SPEECH_PRIVACY_NOT_ACCEPTED".to_string(),
            message: "Windows speech recognition is blocked until Speech privacy is enabled. Open Settings > Privacy & security > Speech and turn on Online speech recognition, then try dictation again.".to_string(),
            retryable: false,
        };
    }

    if lower.contains("language") || lower.contains("0x8004503a") {
        return HelperResponse::Err {
            ok: false,
            code: "LANGUAGE_NOT_AVAILABLE".to_string(),
            message,
            retryable: false,
        };
    }

    if lower.contains("privacy") || lower.contains("microphone") {
        return HelperResponse::Err {
            ok: false,
            code: "MIC_PERMISSION_DENIED".to_string(),
            message,
            retryable: false,
        };
    }

    HelperResponse::Err {
        ok: false,
        code: "TRANSCRIPTION_FAILED".to_string(),
        message,
        retryable: true,
    }
}
