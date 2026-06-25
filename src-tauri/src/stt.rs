//! OpenAI-backed speech-to-text + the voice-command interpreter's chat proxy.
//!
//! Everything runs through OpenAI's cloud API; there are no local engines or
//! downloaded models. Two responsibilities live here, both thin HTTP proxies
//! done in Rust (not the webview) to avoid CORS and keep the request building
//! off the UI thread:
//!   - `stt_transcribe_openai` : mic WAV -> text (audio/transcriptions).
//!   - `openai_chat`           : a generic chat/completions proxy used by the
//!                               voice-command interpreter (tool calling).
//!
//! The API key is user-entered, stored locally, and never logged.

use base64::Engine as _;
use serde::Deserialize;
use serde_json::Value;

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// Build an HTTP agent with an explicit native-tls (SChannel) connector. The
/// bare `ureq::get` has no TLS backend compiled in once default features are off.
fn http_agent() -> Result<ureq::Agent, String> {
    let connector = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(connector))
        .redirects(10)
        .build())
}

/* --------------------------- OpenAI cloud STT ---------------------------- */

#[derive(Deserialize)]
pub struct OpenAiArgs {
    pub api_key: String,
    pub model: String,
    pub lang: Option<String>,
    pub wav_base64: String,
}

fn form_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
            .as_bytes(),
    );
}

/// Transcribe a WAV via OpenAI's audio API. Runs through the Rust HTTP client
/// (not the webview) to avoid CORS, and keeps the key out of the JS bundle.
/// The key is never logged. Async so the network call never blocks the UI.
#[tauri::command]
pub async fn stt_transcribe_openai(args: OpenAiArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || openai_blocking(args))
        .await
        .map_err(|e| e.to_string())?
}

fn openai_blocking(args: OpenAiArgs) -> Result<String, String> {
    if args.api_key.trim().is_empty() {
        return Err("Clé API OpenAI manquante".into());
    }
    let wav = B64
        .decode(args.wav_base64.as_bytes())
        .map_err(|e| e.to_string())?;

    let boundary = format!("----vatoForm{}", unique_stamp());
    let mut body: Vec<u8> = Vec::with_capacity(wav.len() + 512);
    form_field(&mut body, &boundary, "model", &args.model);
    form_field(&mut body, &boundary, "response_format", "text");
    if let Some(l) = args.lang.as_deref() {
        if !l.is_empty() && l != "auto" {
            form_field(&mut body, &boundary, "language", l);
        }
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(&wav);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let agent = http_agent()?;
    let resp = agent
        .post("https://api.openai.com/v1/audio/transcriptions")
        .set("Authorization", &format!("Bearer {}", args.api_key))
        .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .send_bytes(&body);

    match resp {
        Ok(r) => r
            .into_string()
            .map(|s| s.trim().to_string())
            .map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            // Surface OpenAI's message (e.g. insufficient_quota) without the key.
            Err(format!("OpenAI {code} : {}", detail.trim()))
        }
        Err(e) => Err(e.to_string()),
    }
}

/* ------------------------- OpenAI chat (commands) ------------------------ */

#[derive(Deserialize)]
pub struct ChatArgs {
    pub api_key: String,
    /// The full chat/completions request body (model, messages, tools, …). The
    /// front-end builds it so the tool schema lives next to its executor.
    pub body: Value,
}

/// Generic proxy to `POST /v1/chat/completions`. Returns the raw response JSON
/// as a string; the front-end runs the tool-call loop (it parses `tool_calls`,
/// executes them locally, and calls back with the results). Done in Rust to
/// avoid CORS and keep the key out of the bundle. The key is never logged.
#[tauri::command]
pub async fn openai_chat(args: ChatArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || chat_blocking(args))
        .await
        .map_err(|e| e.to_string())?
}

fn chat_blocking(args: ChatArgs) -> Result<String, String> {
    if args.api_key.trim().is_empty() {
        return Err("Clé API OpenAI manquante".into());
    }
    let agent = http_agent()?;
    let resp = agent
        .post("https://api.openai.com/v1/chat/completions")
        .set("Authorization", &format!("Bearer {}", args.api_key))
        .set("Content-Type", "application/json")
        .send_json(args.body);

    match resp {
        Ok(r) => r.into_string().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            Err(format!("OpenAI {code} : {}", detail.trim()))
        }
        Err(e) => Err(e.to_string()),
    }
}

/* ------------------------------- OpenAI TTS ------------------------------ */

#[derive(Deserialize)]
pub struct TtsArgs {
    pub api_key: String,
    pub model: String,
    pub voice: String,
    pub input: String,
}

/// Text-to-speech via OpenAI → base64-encoded MP3 bytes. Done in Rust (CORS +
/// key safety); the front-end plays the returned audio. Key is never logged.
#[tauri::command]
pub async fn openai_tts(args: TtsArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || tts_blocking(args))
        .await
        .map_err(|e| e.to_string())?
}

fn tts_blocking(args: TtsArgs) -> Result<String, String> {
    if args.api_key.trim().is_empty() {
        return Err("Clé API OpenAI manquante".into());
    }
    let body = serde_json::json!({
        "model": args.model,
        "voice": args.voice,
        "input": args.input,
        "response_format": "mp3",
    });
    let agent = http_agent()?;
    let resp = agent
        .post("https://api.openai.com/v1/audio/speech")
        .set("Authorization", &format!("Bearer {}", args.api_key))
        .set("Content-Type", "application/json")
        .send_json(body);

    match resp {
        Ok(r) => {
            use std::io::Read;
            let mut reader = r.into_reader();
            let mut buf = Vec::new();
            reader.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            Ok(B64.encode(&buf))
        }
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            Err(format!("OpenAI {code} : {}", detail.trim()))
        }
        Err(e) => Err(e.to_string()),
    }
}

fn unique_stamp() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}
