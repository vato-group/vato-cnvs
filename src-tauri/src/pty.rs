use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Rolling raw-output kept per PTY so a freshly mounted xterm (after a workspace
/// switch remounts the pane) can be repainted from scratch. A plain shell never
/// reprints its screen on SIGWINCH — only full-screen TUIs do — so without a
/// replay the pane stays black until the next keystroke. ~512 KiB holds the
/// visible screen plus a healthy scrollback; older bytes drop off the front.
const BACKLOG_CAP: usize = 512 * 1024;

/// Append a line to `%TEMP%/vato-cnvs/debug.log` (diagnostics for agent resume).
/// Cheap, best-effort; never panics. Front-end logs route here too via the
/// `debug_log` command so the whole resume flow lands in one readable file.
pub fn dbg_log(line: &str) {
    use std::io::Write;
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut dir = std::env::temp_dir();
    dir.push("vato-cnvs");
    let _ = std::fs::create_dir_all(&dir);
    dir.push("debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&dir) {
        let _ = writeln!(f, "{ms} {line}");
    }
    eprintln!("[vato] {line}");
}

/// All fields are `Send`, so the instance is safe to keep in shared Tauri state.
pub struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Shared with the reader thread, which appends every emitted chunk (capped
    /// at BACKLOG_CAP). Replayed into a remounted xterm via `pty_backlog`.
    backlog: Arc<Mutex<Vec<u8>>>,
    #[allow(dead_code)]
    pid: Option<u32>,
}

#[derive(Default)]
pub struct PtyState {
    pub map: Mutex<HashMap<String, PtyInstance>>,
}

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub id: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub rows: u16,
    pub cols: u16,
    /// When set, and the program is a known interactive shell, scope its command
    /// history to a per-`cwd` file so each terminal only recalls commands run in
    /// its own directory instead of one machine-wide global history.
    #[serde(default, alias = "scopeHistory")]
    pub scope_history: Option<bool>,
}

/// The interactive shells whose per-directory history we know how to scope.
enum ShellKind {
    /// Windows PowerShell / pwsh — history lives in PSReadLine (`HistorySavePath`).
    PowerShell,
    /// bash / zsh / sh — history file is the `HISTFILE` environment variable.
    Posix,
}

/// Classify a launch program as a shell we can scope, by its file stem
/// (`C:\…\powershell.exe` -> `powershell`). Anything else (an AI agent CLI, a
/// one-off command) returns None and is left untouched.
fn detect_shell(program: &str) -> Option<ShellKind> {
    let stem = std::path::Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    match stem.as_str() {
        "powershell" | "pwsh" => Some(ShellKind::PowerShell),
        "bash" | "zsh" | "sh" => Some(ShellKind::Posix),
        _ => None,
    }
}

/// Stable 32-bit FNV-1a hash (fixed seed -> same value across app runs, so a
/// directory always maps to the same history file).
fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Per-app data directory (`%APPDATA%` on Windows, `$XDG_DATA_HOME` or
/// `~/.local/share` elsewhere) where we keep the per-directory history files.
fn data_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("APPDATA").ok().map(std::path::PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        if let Ok(x) = std::env::var("XDG_DATA_HOME") {
            if !x.trim().is_empty() {
                return Some(std::path::PathBuf::from(x));
            }
        }
        std::env::var("HOME")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join(".local/share"))
    }
}

/// Absolute path of the history file dedicated to `cwd`. Readable basename +
/// stable hash of the full path keeps it unique and filesystem-safe even for
/// long or oddly-named directories. The parent dir is created here.
fn shell_history_file(cwd: &str) -> Option<std::path::PathBuf> {
    let dir = data_dir()?.join("vato-cnvs").join("shell-history");
    std::fs::create_dir_all(&dir).ok()?;
    // Hash case-insensitively on Windows so `C:\Foo` and `c:\foo` share one file.
    #[cfg(windows)]
    let hash = fnv1a(&cwd.to_lowercase());
    #[cfg(not(windows))]
    let hash = fnv1a(cwd);
    let base: String = cwd
        .rsplit(|c| c == '/' || c == '\\')
        .find(|s| !s.is_empty())
        .unwrap_or("dir")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let base = if base.is_empty() { "dir".to_string() } else { base.to_lowercase() };
    Some(dir.join(format!("{base}-{hash:08x}.txt")))
}

/// Point an interactive shell's command history at a per-`cwd` file. PowerShell
/// gets an extra `-NoExit -Command "Set-PSReadLineOption -HistorySavePath …"`
/// (run before the first interactive prompt, so up-arrow recall reads it);
/// posix shells get a `HISTFILE` (+ size knobs) env. Returns any args to append
/// and env vars to set. No-op for non-shell programs or a missing cwd.
fn apply_history_scope(
    program: &str,
    cwd: &Option<String>,
    args: &mut Vec<String>,
    env_out: &mut Vec<(String, String)>,
) {
    let Some(cwd) = cwd.as_deref().filter(|c| !c.trim().is_empty()) else {
        return;
    };
    let Some(kind) = detect_shell(program) else {
        return;
    };
    let Some(file) = shell_history_file(cwd) else {
        return;
    };
    let file = file.to_string_lossy().to_string();
    match kind {
        ShellKind::PowerShell => {
            // Don't fight an explicit -Command/-File/-NoExit launch.
            let occupied = args.iter().any(|a| {
                let l = a.to_ascii_lowercase();
                matches!(l.as_str(), "-command" | "-c" | "-file" | "-noexit")
            });
            if occupied {
                return;
            }
            let esc = file.replace('\'', "''"); // ' is the only PS single-quote escape
            args.push("-NoExit".into());
            args.push("-Command".into());
            args.push(format!("Set-PSReadLineOption -HistorySavePath '{esc}'"));
        }
        ShellKind::Posix => {
            env_out.push(("HISTFILE".into(), file));
            env_out.push(("HISTSIZE".into(), "10000".into()));
            env_out.push(("SAVEHIST".into(), "10000".into()));
            env_out.push(("HISTFILESIZE".into(), "10000".into()));
        }
    }
    dbg_log(&format!("HISTORY_SCOPE program={program} cwd={cwd}"));
}

/// Resolve a program and wrap shims so they run interactively under the right
/// interpreter (Windows npm/global installs are usually `.cmd`/`.ps1` shims that
/// `CreateProcess` cannot launch directly):
///   `.exe` / no ext -> spawn directly
///   `.cmd` / `.bat` -> `cmd.exe /c <path> <args...>`
///   `.ps1`          -> `powershell.exe -NoLogo -ExecutionPolicy Bypass -File <path> <args...>`
fn build_command(program: &str, args: &[String]) -> CommandBuilder {
    #[cfg(windows)]
    {
        if let Ok(resolved) = which::which(program) {
            let ext = resolved
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            let path = resolved.to_string_lossy().to_string();
            dbg_log(&format!("RESOLVE program={program} -> {path} (ext={ext}) args={args:?}"));
            match ext.as_str() {
                "cmd" | "bat" => {
                    let mut cmd = CommandBuilder::new("cmd.exe");
                    cmd.arg("/c");
                    cmd.arg(&path);
                    for a in args {
                        cmd.arg(a);
                    }
                    return cmd;
                }
                "ps1" => {
                    let mut cmd = CommandBuilder::new("powershell.exe");
                    cmd.arg("-NoLogo");
                    cmd.arg("-ExecutionPolicy");
                    cmd.arg("Bypass");
                    cmd.arg("-File");
                    cmd.arg(&path);
                    for a in args {
                        cmd.arg(a);
                    }
                    return cmd;
                }
                _ => {
                    let mut cmd = CommandBuilder::new(&path);
                    for a in args {
                        cmd.arg(a);
                    }
                    return cmd;
                }
            }
        }
    }
    dbg_log(&format!("RESOLVE_FALLBACK program={program} args={args:?}"));
    // Fallback (non-windows, or resolution failed): spawn as given; error surfaces to UI.
    let mut cmd = CommandBuilder::new(program);
    for a in args {
        cmd.arg(a);
    }
    cmd
}

/// (a) Open a PTY pair, spawn the child, (b) stream output to the frontend.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, Arc<PtyState>>,
    args: SpawnArgs,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: args.rows.max(1),
            cols: args.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Scope shell history to the cwd before resolving the command (PowerShell
    // needs the extra -Command arg baked in; posix shells get a HISTFILE env).
    let mut spawn_args = args.args.clone();
    let mut hist_env: Vec<(String, String)> = Vec::new();
    if args.scope_history.unwrap_or(false) {
        apply_history_scope(&args.program, &args.cwd, &mut spawn_args, &mut hist_env);
    }

    let mut cmd = build_command(&args.program, &spawn_args);
    if let Some(cwd) = &args.cwd {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");
    for (k, v) in &hist_env {
        cmd.env(k, v);
    }
    if let Some(env) = &args.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    dbg_log(&format!(
        "SPAWN id={} program={} args={:?} cwd={:?} size={}x{}",
        args.id, args.program, spawn_args, args.cwd, args.cols, args.rows
    ));
    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            dbg_log(&format!("SPAWN_ERR id={} {e}", args.id));
            return Err(e.to_string());
        }
    };
    let pid = child.process_id();
    dbg_log(&format!("SPAWNED id={} pid={:?}", args.id, pid));
    // Drop slave so the child holds the only slave handle -> clean EOF on exit.
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let backlog = Arc::new(Mutex::new(Vec::<u8>::new()));
    let backlog_w = backlog.clone();

    state.map.lock().unwrap().insert(
        args.id.clone(),
        PtyInstance {
            master: pair.master,
            writer,
            child,
            backlog,
            pid,
        },
    );

    // Reader thread -> emit base64 chunks (binary-safe for ANSI/partial UTF-8).
    let id = args.id.clone();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let out_event = format!("pty://output/{id}");
        let mut total: u64 = 0;
        let mut first = true;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    dbg_log(&format!("EOF id={id} total_bytes={total}"));
                    break; // EOF: child exited
                }
                Ok(n) => {
                    if first {
                        dbg_log(&format!("FIRST_OUTPUT id={id} bytes={n}"));
                        first = false;
                    }
                    total += n as u64;
                    // Keep a rolling copy so a remounted xterm can be repainted.
                    {
                        let mut bl = backlog_w.lock().unwrap();
                        bl.extend_from_slice(&buf[..n]);
                        let overflow = bl.len().saturating_sub(BACKLOG_CAP);
                        if overflow > 0 {
                            bl.drain(0..overflow);
                        }
                    }
                    let chunk = B64.encode(&buf[..n]);
                    if app_handle.emit(&out_event, chunk).is_err() {
                        dbg_log(&format!("EMIT_FAIL id={id}"));
                        break;
                    }
                }
                Err(e) => {
                    dbg_log(&format!("READ_ERR id={id} {e}"));
                    break;
                }
            }
        }
        let _ = app_handle.emit(&format!("pty://exit/{id}"), ());
    });

    Ok(())
}

/// (c) Write raw stdin bytes (base64-encoded from JS to preserve non-UTF8).
#[tauri::command]
pub fn pty_write(
    state: State<'_, Arc<PtyState>>,
    id: String,
    data: String,
) -> Result<(), String> {
    let bytes = B64.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    let mut map = state.map.lock().unwrap();
    let inst = map.get_mut(&id).ok_or("no such terminal")?;
    inst.writer.write_all(&bytes).map_err(|e| e.to_string())?;
    inst.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// (d) Resize the PTY.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, Arc<PtyState>>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let map = state.map.lock().unwrap();
    let inst = map.get(&id).ok_or("no such terminal")?;
    dbg_log(&format!("RESIZE id={id} -> {cols}x{rows}"));
    inst.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// (e) Kill the terminal and its whole process tree.
#[tauri::command]
pub fn pty_kill(state: State<'_, Arc<PtyState>>, id: String) -> Result<(), String> {
    let mut map = state.map.lock().unwrap();
    if let Some(mut inst) = map.remove(&id) {
        // child.kill() only terminates the direct child (often cmd.exe / powershell.exe),
        // leaking the real CLI + its node/grandchildren. taskkill /T kills the tree.
        #[cfg(windows)]
        if let Some(pid) = inst.pid {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                .output();
        }
        let _ = inst.child.kill();
        let _ = inst.child.wait();
        // master/writer dropped here -> ConPTY handles released.
    }
    Ok(())
}

/// True if the running map still holds this terminal id.
#[tauri::command]
pub fn pty_is_alive(state: State<'_, Arc<PtyState>>, id: String) -> bool {
    state.map.lock().unwrap().contains_key(&id)
}

/// (f) Return the rolling output backlog (base64), or None if empty/unknown.
/// A freshly mounted xterm (workspace switch) replays this to restore its
/// content immediately instead of waiting for the next byte of output.
#[tauri::command]
pub fn pty_backlog(state: State<'_, Arc<PtyState>>, id: String) -> Option<String> {
    let map = state.map.lock().unwrap();
    let bl = map.get(&id)?.backlog.lock().unwrap();
    if bl.is_empty() {
        None
    } else {
        Some(B64.encode(&bl[..]))
    }
}
