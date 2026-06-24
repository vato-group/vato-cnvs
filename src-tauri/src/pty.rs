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

    let mut cmd = build_command(&args.program, &args.args);
    if let Some(cwd) = &args.cwd {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");
    if let Some(env) = &args.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    dbg_log(&format!(
        "SPAWN id={} program={} args={:?} cwd={:?} size={}x{}",
        args.id, args.program, args.args, args.cwd, args.cols, args.rows
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

    state.map.lock().unwrap().insert(
        args.id.clone(),
        PtyInstance {
            master: pair.master,
            writer,
            child,
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
