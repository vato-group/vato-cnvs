//! Local speech-to-text orchestration.
//!
//! We don't link an ASR model into the binary (that would need libclang/bindgen
//! and a multi-GB build). Instead the backend drives **sidecar executables** +
//! downloaded model files living under the app-data dir:
//!   - `whisper`  : whisper.cpp `whisper-cli.exe` + a GGUF model (multilingual).
//!   - `parakeet` : an external sidecar (Python/ONNX) — English-only, optional.
//!
//! The frontend captures the mic, encodes a 16 kHz mono WAV, and hands the bytes
//! to `stt_transcribe`, which runs the chosen engine and returns the text.

use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// whisper.cpp renamed its CLI over time (`main` -> `whisper-cli`); accept all.
const WHISPER_BIN_NAMES: &[&str] = &[
    "whisper-cli.exe",
    "whisper-cli",
    "main.exe",
    "main",
    "whisper.exe",
    "whisper",
];
const PARAKEET_BIN_NAMES: &[&str] =
    &["parakeet.exe", "parakeet.cmd", "parakeet.bat", "parakeet"];

/// Build an HTTP agent with an explicit native-tls (SChannel) connector. The
/// bare `ureq::get` has no TLS backend compiled in once default features are off.
fn http_agent() -> Result<ureq::Agent, String> {
    let connector = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(connector))
        .redirects(10)
        .build())
}

/// `<app_data>/stt/` — persistent home for binaries + models.
fn stt_dir(app: &AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    dir.push("stt");
    dir
}

fn exists(p: &str) -> bool {
    !p.is_empty() && Path::new(p).exists()
}

/// Resolve the whisper binary: explicit path > bundled dir > PATH.
fn resolve_whisper_bin(app: &AppHandle, given: Option<&str>) -> Option<String> {
    if let Some(g) = given {
        if exists(g) {
            return Some(g.to_string());
        }
    }
    let wdir = stt_dir(app).join("whisper");
    for n in WHISPER_BIN_NAMES {
        let p = wdir.join(n);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    // PATH lookup is restricted to the canonical CLI name. Searching for generic
    // names like "main"/"whisper" would match unrelated exes (→ os error 193).
    for n in ["whisper-cli", "whisper-cli.exe"] {
        if let Ok(p) = which::which(n) {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

/// Pick a downloaded GGUF model (prefer a "turbo" build if several exist).
fn default_whisper_model(app: &AppHandle) -> Option<String> {
    let mdir = stt_dir(app).join("models");
    let mut best: Option<PathBuf> = None;
    for entry in std::fs::read_dir(&mdir).ok()?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|x| x.to_str()) == Some("bin") {
            let is_turbo = p
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains("turbo"))
                .unwrap_or(false);
            if is_turbo {
                return Some(p.to_string_lossy().into_owned());
            }
            best.get_or_insert(p);
        }
    }
    best.map(|p| p.to_string_lossy().into_owned())
}

fn default_parakeet_bin(app: &AppHandle) -> Option<String> {
    let pdir = stt_dir(app).join("parakeet");
    for n in PARAKEET_BIN_NAMES {
        let p = pdir.join(n);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

/* ----------------------------- commands ----------------------------- */

#[derive(Serialize)]
pub struct SttPaths {
    dir: String,
    models_dir: String,
    whisper_dir: String,
    parakeet_dir: String,
}

/// Default filesystem locations, so the UI can pre-fill / show where to drop files.
#[tauri::command]
pub fn stt_paths(app: AppHandle) -> SttPaths {
    let dir = stt_dir(&app);
    SttPaths {
        models_dir: dir.join("models").to_string_lossy().into_owned(),
        whisper_dir: dir.join("whisper").to_string_lossy().into_owned(),
        parakeet_dir: dir.join("parakeet").to_string_lossy().into_owned(),
        dir: dir.to_string_lossy().into_owned(),
    }
}

#[derive(Serialize)]
pub struct EngineStatus {
    engine: String,
    binary: Option<String>,
    binary_ready: bool,
    model: Option<String>,
    model_ready: bool,
    ready: bool,
    note: Option<String>,
}

/// Report whether an engine is usable (binary + model present).
#[tauri::command]
pub fn stt_status(
    app: AppHandle,
    engine: String,
    binary: Option<String>,
    model: Option<String>,
) -> EngineStatus {
    match engine.as_str() {
        "whisper" => {
            let bin = resolve_whisper_bin(&app, binary.as_deref());
            let model_path = model
                .filter(|m| exists(m))
                .or_else(|| default_whisper_model(&app));
            let binary_ready = bin.is_some();
            let model_ready = model_path.is_some();
            EngineStatus {
                engine,
                binary: bin,
                binary_ready,
                model: model_path,
                model_ready,
                ready: binary_ready && model_ready,
                note: if !binary_ready {
                    Some("Binaire whisper-cli introuvable".into())
                } else if !model_ready {
                    Some("Aucun modèle GGUF téléchargé".into())
                } else {
                    None
                },
            }
        }
        "parakeet" => {
            let bin = binary
                .filter(|b| exists(b))
                .or_else(|| default_parakeet_bin(&app));
            let binary_ready = bin.is_some();
            EngineStatus {
                engine,
                binary: bin,
                binary_ready,
                model: None,
                model_ready: true,
                ready: binary_ready,
                note: if binary_ready {
                    None
                } else {
                    Some("Sidecar Parakeet non installé (anglais uniquement)".into())
                },
            }
        }
        other => EngineStatus {
            engine: other.into(),
            binary: None,
            binary_ready: false,
            model: None,
            model_ready: false,
            ready: false,
            note: Some("Moteur STT inconnu".into()),
        },
    }
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    url: String,
    received: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

/// Async wrapper: a multi-GB download on a sync command would block the UI
/// thread and freeze the window. Run it on the blocking pool instead.
#[tauri::command]
pub async fn stt_download(app: AppHandle, url: String, dest: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || download_blocking(app, url, dest))
        .await
        .map_err(|e| e.to_string())?
}

/// Stream-download a file (model/binary) to `dest`, emitting `stt://download`
/// progress events. Writes to a `.part` sidecar then renames on success.
fn download_blocking(app: AppHandle, url: String, dest: String) -> Result<(), String> {
    use std::io::{Read, Write};

    let dest_path = PathBuf::from(&dest);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let emit_err = |app: &AppHandle, msg: String| {
        let _ = app.emit(
            "stt://download",
            DownloadProgress {
                url: url.clone(),
                received: 0,
                total: 0,
                done: true,
                error: Some(msg),
            },
        );
    };

    let agent = match http_agent() {
        Ok(a) => a,
        Err(e) => {
            emit_err(&app, e.clone());
            return Err(e);
        }
    };
    let resp = match agent.get(&url).call() {
        Ok(r) => r,
        Err(e) => {
            emit_err(&app, e.to_string());
            return Err(e.to_string());
        }
    };
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|h| h.parse().ok())
        .unwrap_or(0);

    let tmp = dest_path.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut reader = resp.into_reader();
    let mut buf = [0u8; 65536];
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;

    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                emit_err(&app, e.to_string());
                return Err(e.to_string());
            }
        };
        if let Err(e) = file.write_all(&buf[..n]) {
            emit_err(&app, e.to_string());
            return Err(e.to_string());
        }
        received += n as u64;
        if received - last_emit >= 1_000_000 {
            last_emit = received;
            let _ = app.emit(
                "stt://download",
                DownloadProgress {
                    url: url.clone(),
                    received,
                    total,
                    done: false,
                    error: None,
                },
            );
        }
    }

    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&tmp, &dest_path).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "stt://download",
        DownloadProgress {
            url,
            received,
            total,
            done: true,
            error: None,
        },
    );
    Ok(())
}

/* ----------------------- one-click whisper install ----------------------- */

const WHISPER_BIN_ZIP: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip";

fn emit_install(app: &AppHandle, received: u64, total: u64, done: bool, error: Option<String>) {
    let _ = app.emit(
        "stt://install",
        DownloadProgress {
            url: "whisper-bin-x64".into(),
            received,
            total,
            done,
            error,
        },
    );
}

/// Download the whisper.cpp x64 release zip and flatten-extract the CLI + its
/// DLLs into `stt/whisper/`. Emits `stt://install` progress.
#[tauri::command]
pub async fn stt_install_whisper(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || install_whisper_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn install_whisper_blocking(app: AppHandle) -> Result<(), String> {
    use std::io::Read;

    let dir = stt_dir(&app).join("whisper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let agent = http_agent().map_err(|e| {
        emit_install(&app, 0, 0, true, Some(e.clone()));
        e
    })?;
    let resp = agent.get(WHISPER_BIN_ZIP).call().map_err(|e| {
        let m = e.to_string();
        emit_install(&app, 0, 0, true, Some(m.clone()));
        m
    })?;
    let total = resp
        .header("Content-Length")
        .and_then(|h| h.parse().ok())
        .unwrap_or(0);

    // The bin zip is small (~tens of MB); buffer it (ZipArchive needs Seek).
    let mut reader = resp.into_reader();
    let mut data = Vec::new();
    let mut chunk = [0u8; 65536];
    let mut received: u64 = 0;
    let mut last: u64 = 0;
    loop {
        let n = match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                emit_install(&app, received, total, true, Some(e.to_string()));
                return Err(e.to_string());
            }
        };
        data.extend_from_slice(&chunk[..n]);
        received += n as u64;
        if received - last >= 500_000 {
            last = received;
            emit_install(&app, received, total, false, None);
        }
    }

    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| {
        let m = e.to_string();
        emit_install(&app, received, total, true, Some(m.clone()));
        m
    })?;

    // Flatten: strip internal folders so the exe + DLLs land side by side.
    let mut extracted = 0;
    for i in 0..zip.len() {
        let mut f = match zip.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        if f.is_dir() {
            continue;
        }
        let base = f.name().replace('\\', "/");
        let base = base.rsplit('/').next().unwrap_or("").to_string();
        if base.is_empty() {
            continue;
        }
        let out = dir.join(&base);
        let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut o).map_err(|e| e.to_string())?;
        extracted += 1;
    }

    if extracted == 0 {
        let m = "Archive vide ou format inattendu".to_string();
        emit_install(&app, received, total, true, Some(m.clone()));
        return Err(m);
    }

    emit_install(&app, received, total, true, None);
    Ok(())
}

#[derive(Deserialize)]
pub struct TranscribeArgs {
    pub engine: String,
    pub binary: Option<String>,
    pub model: Option<String>,
    pub lang: Option<String>,
    /// 16-bit PCM mono 16 kHz WAV, base64-encoded.
    pub wav_base64: String,
}

/// Async wrapper: the sidecar can run for several seconds; keep it off the UI
/// thread so the window stays responsive during transcription.
#[tauri::command]
pub async fn stt_transcribe(app: AppHandle, args: TranscribeArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_blocking(app, args))
        .await
        .map_err(|e| e.to_string())?
}

/// Transcribe a recorded WAV with the chosen engine; returns plain text.
fn transcribe_blocking(app: AppHandle, args: TranscribeArgs) -> Result<String, String> {
    let bytes = B64
        .decode(args.wav_base64.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut wav = std::env::temp_dir();
    wav.push("vato-cnvs");
    std::fs::create_dir_all(&wav).map_err(|e| e.to_string())?;
    wav.push(format!("rec-{}.wav", unique_stamp()));
    std::fs::write(&wav, &bytes).map_err(|e| e.to_string())?;

    let result = run_engine(&app, &args, &wav);
    let _ = std::fs::remove_file(&wav);
    result
}

fn run_engine(app: &AppHandle, args: &TranscribeArgs, wav: &Path) -> Result<String, String> {
    let lang = args.lang.clone().unwrap_or_else(|| "auto".into());
    let wav_str = wav.to_string_lossy().into_owned();

    match args.engine.as_str() {
        "whisper" => {
            let bin = resolve_whisper_bin(app, args.binary.as_deref())
                .ok_or("Binaire Whisper introuvable")?;
            let model = args
                .model
                .clone()
                .filter(|m| exists(m))
                .or_else(|| default_whisper_model(app))
                .ok_or("Modèle Whisper introuvable")?;
            let mut cmd = Command::new(&bin);
            // -nt: no timestamps, -np: no progress prints -> stdout is just text.
            cmd.args([
                "-m", &model, "-f", &wav_str, "-l", &lang, "-nt", "-np",
            ]);
            run_capture(cmd)
        }
        "parakeet" => {
            let bin = args
                .binary
                .clone()
                .filter(|b| exists(b))
                .or_else(|| default_parakeet_bin(app))
                .ok_or("Sidecar Parakeet introuvable")?;
            let mut cmd = Command::new(&bin);
            // Contract: sidecar takes the WAV path and prints text to stdout.
            cmd.arg(&wav_str);
            if let Some(m) = args.model.as_ref().filter(|m| exists(m)) {
                cmd.args(["--model", m]);
            }
            run_capture(cmd)
        }
        other => Err(format!("Moteur STT inconnu : {other}")),
    }
}

fn run_capture(mut cmd: Command) -> Result<String, String> {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Échec transcription : {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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

fn unique_stamp() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}
