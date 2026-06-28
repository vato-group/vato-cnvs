mod agent_sessions;
mod pty;
mod stt;

use std::sync::Arc;

use agent_sessions::{agent_session_id, claude_session_exists};
use base64::Engine;
use pty::{pty_backlog, pty_is_alive, pty_kill, pty_resize, pty_spawn, pty_write, PtyState};
use stt::{openai_chat, openai_tts, stt_transcribe_openai};

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

/// Open an http(s) URL in the user's real system browser. Used when a terminal
/// link is double-clicked (single/ctrl-click opens our in-app browser pane).
/// Scheme-guarded so a terminal can't make us launch arbitrary protocols. On
/// Windows we go through `rundll32 url.dll,FileProtocolHandler` rather than
/// `cmd /c start` because the latter mangles `&` in query strings.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("unsupported url scheme".into());
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Move the OS mouse cursor onto a point of the main window's client area. The
/// coordinates are LOGICAL/CSS pixels relative to the window's top-left — exactly
/// what `getBoundingClientRect()` returns in the WebView — so the control center
/// can drop the pointer onto an agent it navigated to. Best-effort: any runtime
/// that doesn't support cursor warping just returns an error the front swallows.
#[tauri::command]
fn move_cursor(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    use tauri::Manager;
    let window = app.get_webview_window("main").ok_or("no main window")?;
    window
        .set_cursor_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
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

/// macOS/Linux apps launched from Finder/Launchpad inherit a bare login PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), so user-installed CLIs (`claude`, `codex`,
/// …) living in `~/.local/bin`, Homebrew, bun/npm globals, etc. are invisible to
/// both `which::which` (the `cli_check` overlay) and the PTY spawn. Capture the
/// real PATH from a login+interactive shell once at startup and install it into
/// the process environment so every later `which` and `CommandBuilder` sees it.
/// Best-effort: on any failure we leave the inherited PATH untouched.
#[cfg(not(windows))]
fn hydrate_path_from_login_shell() {
    use std::process::{Command, Stdio};

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // Markers isolate PATH from any banner/prompt noise an interactive rc prints.
    let script = r#"printf '__VATO_PATH_START__%s__VATO_PATH_END__' "$PATH""#;
    let Ok(out) = Command::new(&shell)
        .args(["-ilc", script])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return;
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let Some(start) = stdout.find("__VATO_PATH_START__") else {
        return;
    };
    let rest = &stdout[start + "__VATO_PATH_START__".len()..];
    let Some(end) = rest.find("__VATO_PATH_END__") else {
        return;
    };
    let path = rest[..end].trim();
    if !path.is_empty() {
        std::env::set_var("PATH", path);
    }
}

/// Turn off WebView2's built-in "browser accelerator keys" (Ctrl+D, Ctrl+P,
/// Ctrl+F, the lone Alt menu-accelerator, …). They are handled natively by the
/// WebView *before* the DOM, so `preventDefault()` in our JS shortcut handler
/// can't stop them — and when such a key reaches the WebView with no native
/// action to perform, Windows plays its system "ding". Our own shortcuts keep
/// working (they ride the normal DOM keydown); this only mutes the beep.
#[cfg(windows)]
fn silence_webview_accelerator_beep(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must run before any `which`/PTY work so the user's real PATH is in scope.
    #[cfg(not(windows))]
    hydrate_path_from_login_shell();

    let state = Arc::new(PtyState::default());

    // `mut` is only used by the release-only updater block below; allow it so a
    // debug build (where that block is cfg'd out) doesn't warn about unused mut.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init());

    // The updater reads a `plugins.updater` config (endpoints + minisign pubkey)
    // that only exists for signed release builds; initializing it in a dev build
    // panics with "invalid type: null, expected struct Config". Auto-update is
    // pointless in dev anyway, so only wire the plugin into release builds.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(state)
        .setup(|_app| {
            // Mute the Windows system "ding" that WebView2 emits on browser
            // accelerator keys (Ctrl+D, Ctrl+P, Alt, …) used as app shortcuts.
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    silence_webview_accelerator_beep(&window);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_is_alive,
            pty_backlog,
            cli_check,
            open_external,
            move_cursor,
            home_dir,
            list_dir,
            debug_log,
            agent_session_id,
            claude_session_exists,
            save_temp_image,
            stt_transcribe_openai,
            openai_chat,
            openai_tts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
