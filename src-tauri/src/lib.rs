mod agent_sessions;
mod pty;
mod stt;

use std::sync::Arc;

use agent_sessions::{agent_session_id, claude_session_exists};
use base64::Engine;
use pty::{pty_is_alive, pty_kill, pty_resize, pty_spawn, pty_write, PtyState};
use stt::{
    stt_download, stt_install_whisper, stt_paths, stt_status, stt_transcribe, stt_transcribe_openai,
};

/// True if a CLI program is resolvable on PATH (handles .exe/.cmd/.ps1 via PATHEXT).
#[tauri::command]
fn cli_check(program: String) -> bool {
    which::which(&program).is_ok()
}

/// Append a front-end diagnostic line to the shared debug log (resume tracing).
#[tauri::command]
fn debug_log(line: String) {
    pty::dbg_log(&line);
}

/// Return the user's home directory (default cwd for new terminals).
#[tauri::command]
fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

/// A single directory level: its normalized path, its parent (None at a root),
/// the immediate sub-directories and how many plain files it holds.
#[derive(serde::Serialize)]
struct DirListing {
    path: String,
    parent: Option<String>,
    entries: Vec<DirEntry>,
    file_count: usize,
}

/// Strip the Windows `\\?\` verbatim prefix that `canonicalize` adds, so the
/// path we hand back to the UI reads cleanly (`C:\Users\…`).
fn clean_path(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
}

/// Browse the filesystem for the "choose a project root" picker. Resolves `path`
/// (defaulting to the home dir), then lists its sub-directories so the front-end
/// `cd`-style navigator can drill in. Files are only counted, not returned.
#[tauri::command]
fn list_dir(path: Option<String>) -> Result<DirListing, String> {
    let base = match path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p.trim()),
        _ => std::path::PathBuf::from(
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .map_err(|_| "Dossier personnel introuvable".to_string())?,
        ),
    };

    let resolved = std::fs::canonicalize(&base)
        .map_err(|_| format!("Dossier introuvable : {}", base.to_string_lossy()))?;
    if !resolved.is_dir() {
        return Err(format!("Ce n'est pas un dossier : {}", clean_path(&resolved)));
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    let mut file_count = 0usize;
    let read = std::fs::read_dir(&resolved)
        .map_err(|e| format!("Lecture impossible : {}", e))?;
    for item in read.flatten() {
        let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            let name = item.file_name().to_string_lossy().to_string();
            // Skip Windows junctions/system noise that can't be entered cleanly.
            if name.starts_with('$') {
                continue;
            }
            entries.push(DirEntry { name, is_dir: true });
        } else {
            file_count += 1;
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(DirListing {
        parent: resolved.parent().map(clean_path),
        path: clean_path(&resolved),
        entries,
        file_count,
    })
}

/// Write base64-encoded image bytes to a temp file and return its absolute path.
/// Used for "paste image into terminal" and "send whiteboard to AI".
#[tauri::command]
fn save_temp_image(data_base64: String, ext: Option<String>) -> Result<String, String> {
    // Accept either a raw base64 string or a full data URL.
    let payload = data_base64
        .split_once(',')
        .map(|(_, b)| b.to_string())
        .unwrap_or(data_base64);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.as_bytes())
        .map_err(|e| e.to_string())?;

    let ext = ext.unwrap_or_else(|| "png".into());
    let mut dir = std::env::temp_dir();
    dir.push("vato-cnvs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.push(format!("paste-{}.{}", unique_stamp(), ext));
    std::fs::write(&dir, &bytes).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

fn unique_stamp() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(PtyState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_is_alive,
            cli_check,
            home_dir,
            list_dir,
            debug_log,
            agent_session_id,
            claude_session_exists,
            save_temp_image,
            stt_paths,
            stt_status,
            stt_download,
            stt_install_whisper,
            stt_transcribe,
            stt_transcribe_openai
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
