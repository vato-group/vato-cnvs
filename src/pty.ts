import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Binary-safe base64 <-> bytes (loop avoids call-stack overflow on big buffers).
function enc(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function dec(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export interface PtySpawnArgs {
  id: string;
  program: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  rows: number;
  cols: number;
  /** Scope this shell's command history to its cwd (per-directory recall). */
  scopeHistory?: boolean;
}

export async function ptySpawn(a: PtySpawnArgs): Promise<void> {
  await invoke("pty_spawn", { args: a });
}

/** Subscribe to a terminal's output stream. Returns an unlisten fn. */
export function onPtyOutput(id: string, onData: (bytes: Uint8Array) => void): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${id}`, (e) => onData(dec(e.payload)));
}

/** Fires when the child process exits / the PTY closes. */
export function onPtyExit(id: string, cb: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${id}`, () => cb());
}

// Large inputs (a long paste) must not hit the PTY as one giant burst: Windows
// ConPTY has a bounded input queue, and a single oversized write_all overflows
// it — the child (Claude/Codex TUI) silently loses the middle of the text, so a
// long paste lands only half-in. Split into modest chunks and pace them so
// conhost and the child can drain between writes. Small typed input takes the
// fast single-write path unchanged.
const WRITE_CHUNK = 1024;
const CHUNK_DELAY_MS = 3;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Serialize writes per terminal id so the chunks of a long paste stay contiguous
// instead of being interleaved by a keystroke's write resolving mid-paste.
const writeChains = new Map<string, Promise<void>>();

async function writeRaw(id: string, data: Uint8Array): Promise<void> {
  if (data.length <= WRITE_CHUNK) {
    await invoke("pty_write", { id, data: enc(data) });
    return;
  }
  for (let off = 0; off < data.length; off += WRITE_CHUNK) {
    await invoke("pty_write", { id, data: enc(data.subarray(off, off + WRITE_CHUNK)) });
    if (off + WRITE_CHUNK < data.length) await delay(CHUNK_DELAY_MS);
  }
}

export function ptyWrite(id: string, data: Uint8Array): Promise<void> {
  const prev = writeChains.get(id) ?? Promise.resolve();
  const next = prev.then(() => writeRaw(id, data));
  // Keep the chain alive even if a write rejects, but surface the error to the
  // caller's own `.catch`.
  writeChains.set(id, next.catch(() => {}));
  return next;
}

/** Write the same bytes to several terminals at once (the broadcast bar). */
export async function broadcastWrite(ids: string[], data: Uint8Array): Promise<void> {
  await Promise.all(ids.map((id) => ptyWrite(id, data).catch(() => {})));
}

export async function ptyResize(id: string, rows: number, cols: number): Promise<void> {
  await invoke("pty_resize", { id, rows, cols });
}

export async function ptyKill(id: string): Promise<void> {
  await invoke("pty_kill", { id });
}

export function ptyIsAlive(id: string): Promise<boolean> {
  return invoke<boolean>("pty_is_alive", { id });
}

/**
 * The PTY's rolling output backlog, or null if empty. Replayed into a freshly
 * mounted xterm after a workspace switch so the pane shows its previous content
 * immediately (a plain shell won't repaint on SIGWINCH like a TUI does).
 */
export async function ptyBacklog(id: string): Promise<Uint8Array | null> {
  const b64 = await invoke<string | null>("pty_backlog", { id });
  return b64 ? dec(b64) : null;
}

/** True if a CLI program resolves on PATH. */
export function cliCheck(program: string): Promise<boolean> {
  return invoke<boolean>("cli_check", { program });
}

export function homeDir(): Promise<string | null> {
  return invoke<string | null>("home_dir");
}

/** Open an http(s) URL in the user's real system browser (double-click a link). */
export function openExternal(url: string): Promise<void> {
  return invoke<void>("open_external", { url });
}

/**
 * Warp the OS mouse cursor onto a point of the window's client area (logical/CSS
 * pixels, as from `getBoundingClientRect`). Used by the control center to drop
 * the pointer on an agent it navigates to. No-op (silently) outside Tauri.
 */
export function moveCursor(x: number, y: number): Promise<void> {
  return invoke<void>("move_cursor", { x, y }).catch(() => {});
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

/** One filesystem level for the "choose a project root" navigator. */
export interface DirListing {
  /** Normalized absolute path of the listed directory. */
  path: string;
  /** Parent directory, or null at a filesystem root. */
  parent: string | null;
  /** Immediate sub-directories (sorted, case-insensitive). */
  entries: DirEntry[];
  /** Number of plain files in the directory (shown as a hint only). */
  file_count: number;
}

/**
 * List a directory's sub-folders for the workspace folder picker. `path`
 * defaults to the home dir; passing `<current>/<name>` or a parent path lets the
 * UI drill in/out. Rejects with a French message when the path can't be read.
 */
export function listDir(path?: string): Promise<DirListing> {
  return invoke<DirListing>("list_dir", { path: path ?? null });
}

/** Append a diagnostic line to the shared debug log (%TEMP%/vato-cnvs/debug.log). */
export function debugLog(line: string): void {
  // eslint-disable-next-line no-console
  console.log("[vato]", line);
  invoke("debug_log", { line }).catch(() => {});
}

/**
 * Latest session id of an agent CLI (`claude`/`codex`) in `cwd`, restricted to
 * sessions touched after `startedAfterMs` (epoch ms of the pane's launch).
 * Returns null when nothing matches yet (the session file may not exist until
 * the agent's first message). Used to capture the conversation id for resume.
 */
export function agentSessionId(
  kind: "claude" | "codex",
  cwd: string,
  startedAfterMs: number,
): Promise<string | null> {
  return invoke<string | null>("agent_session_id", { kind, cwd, startedAfterMs });
}

/**
 * Does Claude's session file `<cwd>/<sessionId>.jsonl` exist yet? Claude writes
 * it only on the first user message, so a pane can be "resumable" (it ran) with
 * no real conversation — resuming that errors "No conversation found". Check
 * before passing `--resume`.
 */
export function claudeSessionExists(cwd: string, sessionId: string): Promise<boolean> {
  return invoke<boolean>("claude_session_exists", { cwd, sessionId });
}

/** Persist base64 / data-url image bytes to a temp file; returns absolute path. */
export function saveTempImage(dataBase64: string, ext?: string): Promise<string> {
  return invoke<string>("save_temp_image", { dataBase64, ext });
}

export const encodeUtf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
