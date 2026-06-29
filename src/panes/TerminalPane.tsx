import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { CLIS, buildSpawnArgs, detectAgentCommand } from "../data/clis";
import type { WindowItem } from "../types";
import { useTerminal } from "../hooks/useTerminal";
import { captureAgentSession } from "../lib/sessionCapture";
import {
  claudeSessionExists,
  cliCheck,
  debugLog,
  encodeUtf8,
  onPtyExit,
  onPtyOutput,
  openExternal,
  ptyBacklog,
  ptyIsAlive,
  ptyResize,
  ptySpawn,
  ptyWrite,
  saveTempImage,
} from "../pty";
import { bus } from "../lib/bus";
import { notify } from "../lib/notify";
import { BUSY_FRESH_MS, looksBusy, looksWaiting, screenSig, stripAnsi } from "../lib/attention";
import { attnLog, tail } from "../lib/attnLog";
import { attachPasteImage } from "../lib/clipboard";
import { perfBytes, perfCount, perfEvent, perfMeasure } from "../lib/perf";
import type { AgentStatus } from "../types";
import type { Terminal } from "@xterm/xterm";
import { registerTermReader, serializeTerminal } from "../voice/termAccess";
import { ChevronDownIcon } from "../ui/icons";
import { gt, useT } from "../i18n";

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
const HIDDEN_OUTPUT_CAP = 128 * 1024;
const BACKLOG_REPLAY_BYTES = 96 * 1024;
const ATTENTION_BACKLOG_BYTES = 64 * 1024;
const decoder = new TextDecoder();

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function TerminalPane({ win, visible = true }: { win: WindowItem; visible?: boolean }) {
  const t = useT();
  const setStatus = useStore((s) => s.setStatus);
  const updateWindow = useStore((s) => s.updateWindow);
  const setLastActiveTerminal = useStore((s) => s.setLastActiveTerminal);

  const def = win.cli ? CLIS[win.cli] : CLIS.shell;
  const dlog = (msg: string) => debugLog(`[${win.title}/${win.id.slice(0, 8)}] ${msg}`);

  const startedRef = useRef(false);
  const subscribedRef = useRef(false);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const idleTimer = useRef<number | undefined>(undefined);
  const finishedTimer = useRef<number | undefined>(undefined);
  const writeRef = useRef<((d: Uint8Array) => void) | null>(null);
  const sizeRef = useRef({ cols: 80, rows: 24 });
  const lineBuf = useRef("");
  const inEscape = useRef(false);
  const resumableMarkedRef = useRef(false);
  const cancelCaptureRef = useRef<(() => void) | null>(null);
  const readyRef = useRef(false);
  const mountedAtRef = useRef(performance.now());
  const spawnPerfStartedAtRef = useRef(0);
  const visibleRef = useRef(visible);
  const hiddenChunksRef = useRef<Uint8Array[]>([]);
  const hiddenBytesRef = useRef(0);
  const hiddenTruncatedRef = useRef(false);
  // When an agent PTY exits, we spawn a plain shell instead of showing the
  // stopped overlay. This ref tracks whether that fallback shell is active so
  // we don't loop: shell exit → stopped overlay (not another fallback).
  const shellFallbackActiveRef = useRef(false);
  const spawnShellFallbackRef = useRef<(() => Promise<void>) | null>(null);
  // ---- smart-border activity tracking ----
  const lastInputRef = useRef(0); // last keystroke time (ms) — echo suppression
  const lastEnterRef = useRef(0); // last Enter time — a submit = real work expected
  // False until the agent's startup paint goes quiet. While false the pane stays
  // neutral (no active/finished flashes for an agent you haven't used yet).
  const settledRef = useRef(false);
  const startSettleTimer = useRef<number | undefined>(undefined);
  // Whether this pane currently *is* an agent (spawn CLI or one launched inside a
  // shell). Kept in a ref so the PTY output handler always sees the live value.
  const isAgentRef = useRef(def.agent);
  const prevAgentRef = useRef(def.agent);
  // Live xterm handle, set on ready — lets the quiet-detection read the rendered
  // screen to tell "waiting for input" apart from "just finished".
  const screenTermRef = useRef<Terminal | null>(null);
  // Current ring state (mirror of the store) so the output handler can tell a mere
  // repaint of a parked prompt from the agent actually resuming work.
  const statusRef = useRef<AgentStatus | undefined>(win.status);
  // One OS notification per attention episode (reset when the agent resumes work),
  // so a repaint/re-settle of the same prompt doesn't ping twice.
  const notifiedRef = useRef(false);
  // Last PTY output time — distinguishes a live "working" footer from a frozen
  // leftover so the busy-hold can't stick "in progress" forever (see markFinished).
  const lastOutputRef = useRef(0);
  // Fingerprint of the screen we last notified for: a later settle to the SAME
  // screen (idle box repaint, cursor blink) must not ping again.
  const lastNotifiedSigRef = useRef("");
  // Snapshot of the screen text at the last settle. A later output burst that
  // reproduces it byte-for-byte is a pure REPAINT (focus in/out, cursor blink),
  // not the agent working — so it must NOT flash the orange "active" ring.
  const settledScreenRef = useRef("");
  // Timestamp until which output is treated as our own forced repaint. A workspace
  // switch re-attaches and fires nudgeRedraw (a SIGWINCH) to paint the TUI into the
  // fresh xterm; that repaint arrives as real PTY output but isn't new work.
  const reattachQuietUntil = useRef(0);
  // Keep statusRef in lockstep with the store so the settle / repaint-suppression
  // logic always reads the live ring state — whoever set it (settle, attach on a
  // workspace switch, a spawn, or the cross-workspace watcher).
  useEffect(() => {
    statusRef.current = win.status;
  }, [win.status]);

  const writeToTerm = useCallback((bytes: Uint8Array) => {
    if (!bytes.length) return;
    const t0 = performance.now();
    writeRef.current?.(bytes);
    perfMeasure("xterm_write", performance.now() - t0);
    perfBytes("xterm_write", bytes.length);
  }, []);

  const clearHiddenOutput = useCallback(() => {
    hiddenChunksRef.current = [];
    hiddenBytesRef.current = 0;
    hiddenTruncatedRef.current = false;
  }, []);

  const enqueueHiddenOutput = useCallback((bytes: Uint8Array) => {
    if (!bytes.length) return;
    hiddenChunksRef.current.push(bytes);
    hiddenBytesRef.current += bytes.length;
    perfBytes("terminal_hidden_buffer", bytes.length);
    while (hiddenBytesRef.current > HIDDEN_OUTPUT_CAP && hiddenChunksRef.current.length) {
      const dropped = hiddenChunksRef.current.shift()!;
      hiddenBytesRef.current -= dropped.length;
      hiddenTruncatedRef.current = true;
      perfCount("terminal_hidden_buffer_trims");
    }
  }, []);

  const readBacklogScreen = useCallback(async () => {
    const bytes = await ptyBacklog(win.id, ATTENTION_BACKLOG_BYTES).catch(() => null);
    if (!bytes?.length) return "";
    const text = stripAnsi(decoder.decode(bytes));
    return text.split(/\r?\n/).slice(-80).join("\n");
  }, [win.id]);

  const [overlay, setOverlay] = useState<{ kind: "idle" | "stopped"; error?: string } | null>(null);
  // Plain shells: xterm owns the scrollback, so onScroll tells us precisely when
  // we're pinned to the bottom. False as soon as the user scrolls up.
  const [atBottom, setAtBottom] = useState(true);
  // Agents (Claude/Codex…) run a full-screen TUI with mouse tracking: they grab
  // the wheel for their OWN scrollback, so xterm's viewport never moves and
  // onScroll never fires. We instead detect the wheel gesture at the DOM level
  // and remember that the user scrolled up. Cleared on a jump-to-bottom click.
  const [agentScrolledUp, setAgentScrolledUp] = useState(false);
  const [paste, setPaste] = useState<{ thumb: string; cap: string; phase: "loading" | "ready" } | null>(null);
  const pasteTimers = useRef<number[]>([]);
  const clearPaste = useCallback(() => {
    pasteTimers.current.forEach((id) => window.clearTimeout(id));
    pasteTimers.current = [];
    setPaste(null);
  }, []);

  // ---- intelligent-border state machine driven by output activity ----
  // Flip to the blue "finished" ring, then auto-clear it back to idle (no ring)
  // after 15s so an agent that's been done a while stops drawing attention.
  // Settle the border from a captured screen: a parked interactive prompt → the
  // persistent violet "waiting" ring; anything else → the blue "finished" ring
  // that fades back to neutral after 15s. Also routes attention when you're not
  // already watching this pane.
  const settle = useCallback(
    (screen: string) => {
      const waiting = looksWaiting(screen);
      settledScreenRef.current = screenSig(screen);
      statusRef.current = waiting ? "waiting" : "finished";
      setStatus(win.id, waiting ? "waiting" : "finished");
      window.clearTimeout(finishedTimer.current);
      // "Waiting on input" persists until you act on it; a plain "finished" fades
      // back to a neutral border after 15s so a long-done agent stops nagging.
      if (!waiting) finishedTimer.current = window.setTimeout(() => setStatus(win.id, "idle"), 15000);
      // The badge / jump-to-next derive straight from this status (waiting/error),
      // so there's nothing extra to flag. Just ping the OS once per episode when the
      // app is in the background, so you can fire agents and walk away.
      const focused = document.hasFocus();
      const sig = screenSig(screen);
      const dupSig = sig !== "" && sig === lastNotifiedSigRef.current;
      const fire = !notifiedRef.current && !dupSig && !focused;
      attnLog("pane", waiting ? "waiting" : "finished", {
        pane: win.id.slice(0, 8),
        title: win.title,
        notify: fire ? "fire" : dupSig ? "skip-dupscreen" : notifiedRef.current ? "skip-dup" : "skip-focus",
        focused,
        tail: tail(screen),
      });
      if (fire) {
        notifiedRef.current = true;
        lastNotifiedSigRef.current = sig;
        notify(`${win.title} — ${def.label}`, gt(waiting ? "notify.waiting" : "notify.finished"));
      }
    },
    [setStatus, win.id, win.title, def.label],
  );

  // Self-reference for the busy re-check below (a useCallback can't list itself
  // as a dep without looping); kept in lockstep just under its definition.
  const markFinishedRef = useRef<() => void | Promise<void>>(() => {});
  const markFinished = useCallback(async () => {
    const screen =
      visibleRef.current && screenTermRef.current
        ? serializeTerminal(screenTermRef.current, 28)
        : await readBacklogScreen();
    // The quiet timer fired, but the screen still shows a working footer (spinner,
    // "esc to interrupt", an elapsed/token counter) — the agent only PAUSED
    // mid-turn (a sub-agent or tool call is running), it isn't done. Don't flip to
    // "finished" and DON'T notify (this was the spam: every lull pinged "finished").
    // Hold the active ring and re-check shortly; the real finish has no footer.
    // Only honour a "still working" footer while output is genuinely live. Once the
    // PTY has been silent past BUSY_FRESH_MS the footer is a frozen leftover — the
    // agent really finished — so fall through and settle instead of holding "active"
    // forever (the stuck "in progress, no notification" bug).
    const silentFor = Date.now() - lastOutputRef.current;
    if (looksBusy(screen) && silentFor < BUSY_FRESH_MS) {
      attnLog("pane", "busy-hold", { pane: win.id.slice(0, 8), title: win.title, silentMs: silentFor, tail: tail(screen) });
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => void markFinishedRef.current(), 1200);
      return;
    }
    settle(screen);
  }, [readBacklogScreen, settle, win.id, win.title]);
  markFinishedRef.current = markFinished;

  const markActive = useCallback(() => {
    // New output = the agent is working again; arm a fresh notification episode so
    // its NEXT settle (its next "your turn") pings again.
    // Log only real transitions (idle/finished/waiting → active); skipping the
    // burst-to-burst churn while already active keeps the trace readable.
    if (statusRef.current !== "active") {
      attnLog("pane", "active", { pane: win.id.slice(0, 8), title: win.title, from: statusRef.current ?? "-" });
    }
    notifiedRef.current = false;
    statusRef.current = "active";
    setStatus(win.id, "active");
    window.clearTimeout(idleTimer.current);
    window.clearTimeout(finishedTimer.current);
    idleTimer.current = window.setTimeout(() => void markFinished(), 800);
  }, [setStatus, win.id, win.title, markFinished]);

  // One output burst from the PTY. Decides whether it counts as the agent
  // *working* (orange ring) or is just noise — startup paint, the echo of the
  // user's own typing, or a plain shell's command output — that must leave the
  // border neutral (no colour). This is the heart of the smart border.
  const onActivity = useCallback(() => {
    // Plain shells never use the smart border — only AI agents do. Launching
    // `claude`/`codex` inside a shell flips isAgentRef (effect below) and from
    // then on the same pane behaves like a spawned agent.
    if (!isAgentRef.current) {
      if (!settledRef.current) {
        settledRef.current = true;
        setStatus(win.id, "idle");
      }
      return;
    }
    // Startup: the agent paints its welcome screen on spawn. That isn't "work",
    // so hold a neutral state and, once the paint goes quiet, settle to idle —
    // never flashing active/finished for an agent the user hasn't talked to yet.
    if (!settledRef.current) {
      window.clearTimeout(startSettleTimer.current);
      startSettleTimer.current = window.setTimeout(() => {
        settledRef.current = true;
        setStatus(win.id, "idle");
      }, 700);
      return;
    }
    // Echo of the user's own keystrokes (the TUI repaints its input box on every
    // key) isn't agent work — suppress it so typing keeps the border at 0 colour.
    // Output right after an Enter IS a submitted prompt → allowed through.
    const now = Date.now();
    if (now - lastInputRef.current < 140 && now - lastEnterRef.current > 140) return;
    // A workspace switch re-attaches and forces a SIGWINCH repaint (nudgeRedraw) to
    // paint the TUI into the fresh xterm. That repaint is OUR doing, not the agent
    // working — ignore it for a beat so a finished/idle pane doesn't flash
    // orange→blue, and a waiting one doesn't blink, on every switch. A genuinely
    // busy agent keeps emitting past this window and lights up then.
    if (now < reattachQuietUntil.current) return;
    if (!visibleRef.current) {
      markActive();
      return;
    }
    // In a settled state (idle / finished / waiting), a fresh burst is often just a
    // REPAINT of the same screen — the TUI redrawing on focus in/out or cursor
    // blink — not the agent working. Re-settle from the current screen (keeps the
    // waiting violet / finished / idle ring) instead of flashing the orange "active"
    // pulse. The agent truly resuming CHANGES the screen (new output, a spinner /
    // "esc to interrupt"), so it no longer matches and falls through to markActive.
    if (statusRef.current === "waiting" || statusRef.current === "finished" || statusRef.current === "idle") {
      const screen = screenTermRef.current ? serializeTerminal(screenTermRef.current, 28) : "";
      // Unchanged screen → pure repaint: leave the ring exactly as it settled.
      if (screen && screenSig(screen) === settledScreenRef.current) return;
      // Changed but still parked on a prompt → keep/refresh the waiting ring.
      if (looksWaiting(screen)) {
        window.clearTimeout(idleTimer.current);
        settle(screen);
        return;
      }
    }
    markActive();
  }, [markActive, settle, setStatus, win.id]);

  // Keep the agent flag in sync with the *current* identity (spawn CLI, or one
  // detected running inside the shell). When a plain shell turns into an agent,
  // reset the settle phase so the agent's startup paint stays neutral instead of
  // flashing "active" — visually it becomes an agent, behaviour included.
  useEffect(() => {
    const nowAgent = CLIS[win.runningCli ?? win.cli ?? "shell"].agent;
    isAgentRef.current = nowAgent;
    if (nowAgent && !prevAgentRef.current) {
      settledRef.current = false;
      setStatus(win.id, "starting");
    }
    prevAgentRef.current = nowAgent;
  }, [win.runningCli, win.cli, setStatus, win.id]);

  // ---- detect an agent launched from inside the shell (input sniffing) ----
  // Buffer the command line the user types; on Enter, if its first token is a
  // known agent CLI, flip the pane's *display* identity (icon/accent/label).
  // Only sniffs while a non-agent shell is in front; an agent's own prompts
  // (which aren't shell commands) are never parsed, avoiding false positives.
  const feedSniffer = useCallback(
    (data: string) => {
      const baseId = win.runningCli ?? win.cli ?? "shell";
      if (CLIS[baseId].agent) {
        lineBuf.current = "";
        return;
      }
      for (const ch of data) {
        // Swallow escape sequences (arrow keys, history, etc.) whole.
        if (inEscape.current) {
          if (/[a-zA-Z~]/.test(ch)) inEscape.current = false;
          continue;
        }
        if (ch === "\x1b") {
          inEscape.current = true;
          lineBuf.current = "";
        } else if (ch === "\r" || ch === "\n") {
          const cli = detectAgentCommand(lineBuf.current);
          lineBuf.current = "";
          if (cli && cli !== win.runningCli) updateWindow(win.id, { runningCli: cli });
        } else if (ch === "\x7f" || ch === "\b") {
          lineBuf.current = lineBuf.current.slice(0, -1);
        } else if (ch === "\x03" || ch === "\x15") {
          lineBuf.current = ""; // Ctrl+C / Ctrl+U: abandon the line
        } else if (ch >= " ") {
          lineBuf.current += ch;
        }
      }
    },
    [updateWindow, win.id, win.cli, win.runningCli],
  );

  const subscribe = useCallback(async () => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;
    const offOut = await onPtyOutput(win.id, (bytes) => {
      lastOutputRef.current = Date.now();
      if (visibleRef.current) writeToTerm(bytes);
      else enqueueHiddenOutput(bytes);
      onActivity();
      // First output from an agent = there's now a conversation worth resuming.
      // Persist it so the next app start relaunches this pane in resume mode.
      if (def.agent && !resumableMarkedRef.current) {
        resumableMarkedRef.current = true;
        if (spawnPerfStartedAtRef.current) {
          perfMeasure("spawn_to_first_output", performance.now() - spawnPerfStartedAtRef.current);
          spawnPerfStartedAtRef.current = 0;
        }
        perfEvent("first_agent_output", { id: win.id.slice(0, 8), bytes: bytes.length });
        dlog(`first output (${bytes.length}b) -> resumable`);
        updateWindow(win.id, { resumable: true });
      }
    });
    const offExit = await onPtyExit(win.id, () => {
      dlog("EXIT event");
      statusRef.current = "error";
      setStatus(win.id, "error"); // counts toward the attention badge / jump-to-next
      // A process dying is worth surfacing — ping the OS once if the app is in the
      // background. (An agent's own clean exit re-spawns a shell below, but you
      // still want to know it stopped.)
      const fireExit = !notifiedRef.current && !document.hasFocus();
      attnLog("pane", "exit", {
        pane: win.id.slice(0, 8),
        title: win.title,
        notify: fireExit ? "fire" : notifiedRef.current ? "skip-dup" : "skip-focus",
      });
      if (fireExit) {
        notifiedRef.current = true;
        notify(`${win.title} — ${def.label}`, gt("notify.error"));
      }
      startedRef.current = false;
      lineBuf.current = "";
      cancelCaptureRef.current?.();
      cancelCaptureRef.current = null;
      updateWindow(win.id, { runningCli: undefined }); // back to the spawn identity
      // Agent pane: auto-spawn a plain shell so the user isn't left with a blank
      // pane. If the fallback shell itself exits, show the stopped overlay normally.
      if (def.agent && !shellFallbackActiveRef.current) {
        void spawnShellFallbackRef.current?.();
      } else {
        shellFallbackActiveRef.current = false;
        setOverlay({ kind: "stopped", error: gt("term.processEnded") });
      }
    });
    unlistenRef.current.push(offOut, offExit);
  }, [enqueueHiddenOutput, onActivity, setStatus, updateWindow, def.agent, def.label, win.id, win.title, writeToTerm]);

  // A full-screen TUI (Claude/Codex) only paints on a draw event. When a pane is
  // spawned while occluded (behind the resume dialog) or re-attached to a still-
  // running PTY (workspace switch → fresh xterm), no draw has hit this xterm yet,
  // so it shows blank. Briefly toggling the PTY width forces a SIGWINCH → the CLI
  // redraws its whole screen into the new xterm.
  const nudgeRedraw = useCallback(() => {
    const ping = () => {
      const { cols, rows } = sizeRef.current;
      if (cols < 2) return;
      dlog(`nudge resize ${cols}x${rows}`);
      ptyResize(win.id, rows, cols - 1).catch(() => {});
      window.setTimeout(() => ptyResize(win.id, rows, cols).catch(() => {}), 80);
    };
    window.setTimeout(ping, 250);
    window.setTimeout(ping, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.id]);

  const spawnShellFallback = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    shellFallbackActiveRef.current = true;
    const shellDef = CLIS.shell;
    const ok = await cliCheck(shellDef.program);
    if (!ok) {
      startedRef.current = false;
      shellFallbackActiveRef.current = false;
      setOverlay({ kind: "idle", error: gt("term.notFound", { program: shellDef.program }) });
      return;
    }
    setOverlay(null);
    settledRef.current = false;
    setStatus(win.id, "starting");
    const { cols, rows } = sizeRef.current;
    try {
      spawnPerfStartedAtRef.current = performance.now();
      await ptySpawn({ id: win.id, program: shellDef.program, args: shellDef.args, cwd: win.cwd, rows, cols, scopeHistory: true });
      nudgeRedraw();
    } catch (e) {
      spawnPerfStartedAtRef.current = 0;
      startedRef.current = false;
      shellFallbackActiveRef.current = false;
      setStatus(win.id, "error");
      setOverlay({ kind: "idle", error: String(e) });
    }
  }, [nudgeRedraw, setStatus, win.id, win.cwd]);
  spawnShellFallbackRef.current = spawnShellFallback;

  const spawnNew = useCallback(async () => {
    if (startedRef.current) {
      dlog("spawnNew skipped (already started)");
      return;
    }
    // Claim synchronously, before any await: onReady's resume() and the autostart
    // effect can both reach here in the same tick; without this they'd both pass
    // the guard during `await cliCheck` and double-spawn the same id (the 2nd
    // pty_spawn overwrites the 1st in Rust → the 1st reader emits a spurious exit
    // → "Processus terminé" over a live agent).
    startedRef.current = true;
    const ok = await cliCheck(def.program);
    dlog(`spawnNew cliCheck(${def.program})=${ok}`);
    if (!ok) {
      startedRef.current = false;
      setOverlay({ kind: "idle", error: gt("term.notFound", { program: def.program }) });
      return;
    }
    await subscribe();
    setOverlay(null);
    updateWindow(win.id, { started: true });
    settledRef.current = false;
    setStatus(win.id, "starting");
    const { cols, rows } = sizeRef.current;
    const cfg = win.cli ? useStore.getState().settings.cli[win.cli] : undefined;
    // Relaunch on the saved conversation when this pane is resumable. Claude only
    // writes its session file on the first user message, so a pane can be marked
    // resumable (it ran) with no real conversation — `--resume` would then error
    // "No conversation found". Verify the file exists first; otherwise start
    // fresh with the same --session-id (it becomes resumable once a message lands).
    let resumable = !!win.resumable;
    if (def.id === "claude" && resumable && win.sessionId) {
      const exists = await claudeSessionExists(win.cwd ?? "", win.sessionId).catch(() => false);
      dlog(`claude session file exists=${exists}`);
      if (!exists) resumable = false;
    }
    const args = buildSpawnArgs(def, cfg, { sessionId: win.sessionId, resumable });
    dlog(`spawnNew args=[${args.join(" ")}] cwd=${win.cwd ?? "(none)"} resumable=${resumable} sid=${win.sessionId ?? "-"}`);
    const startedAt = Date.now();
    try {
      spawnPerfStartedAtRef.current = performance.now();
      await ptySpawn({ id: win.id, program: def.program, args, cwd: win.cwd, rows, cols, scopeHistory: !def.agent });
      dlog("ptySpawn ok");
      nudgeRedraw(); // ensure the TUI paints even if spawned while occluded (resume dialog)
      // CLIs we can't pre-assign an id to (Codex): discover it from disk so we
      // can resume the exact conversation next time. Claude already owns its id.
      if (def.agent && !win.sessionId) {
        cancelCaptureRef.current?.();
        cancelCaptureRef.current = captureAgentSession({
          paneId: win.id,
          cli: def.id,
          cwd: win.cwd,
          startedAfterMs: startedAt,
          onCaptured: (sessionId) => updateWindow(win.id, { sessionId, resumable: true }),
        });
      }
    } catch (e) {
      dlog(`ptySpawn ERROR ${String(e)}`);
      spawnPerfStartedAtRef.current = 0;
      startedRef.current = false;
      setStatus(win.id, "error");
      setOverlay({ kind: "idle", error: String(e) });
    }
  }, [def, subscribe, nudgeRedraw, updateWindow, setStatus, win.id, win.cwd, win.cli, win.sessionId, win.resumable]);

  // Re-attach to an already-running PTY (e.g. after a workspace switch remount).
  const attach = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true; // claim synchronously (same double-call guard as spawnNew)
    dlog("attach (pty alive)");
    await subscribe();
    setOverlay(null);
    updateWindow(win.id, { started: true });
    // Re-attaching to a still-running PTY: settle to a neutral border. If the
    // agent is mid-task the next output burst flips it back to active; if it's
    // idle (the common case) it stays at 0 colour instead of a false "finished".
    settledRef.current = true;
    // The backlog replay + nudgeRedraw below force the TUI to repaint into the fresh
    // xterm. That burst of "output" is ours, not the agent's — silence the smart
    // border long enough to cover both nudge pings (250ms + 1000ms) and their
    // repaint latency, so a settled pane doesn't flash active on every switch.
    reattachQuietUntil.current = Date.now() + 1500;
    // Don't clobber a settled attention state the watcher (or a previous visit)
    // left on this pane — wiping a "waiting"/"error" to idle would blink the badge
    // off on every workspace switch. Only a stale "working" ring needs neutralising.
    if (statusRef.current !== "waiting" && statusRef.current !== "error") {
      statusRef.current = "idle";
      setStatus(win.id, "idle");
    }
    // Repaint the fresh xterm from the PTY's backlog. A full-screen TUI redraws
    // itself on the SIGWINCH below, but a plain shell never does — without the
    // replay it would stay black until the next keystroke ("noir au switch de
    // workspace, revient au scroll/Ctrl-C").
    const backlog = await ptyBacklog(win.id, BACKLOG_REPLAY_BYTES).catch(() => null);
    if (backlog && backlog.length) {
      dlog(`replay backlog ${backlog.length}b`);
      writeToTerm(backlog);
    }
    const { cols, rows } = sizeRef.current;
    ptyResize(win.id, rows, cols).catch(() => {});
    nudgeRedraw(); // belt-and-braces: force a TUI to repaint its alternate screen
  }, [subscribe, nudgeRedraw, updateWindow, setStatus, win.id, writeToTerm]);

  const resume = useCallback(async () => {
    if (startedRef.current) return;
    const alive = await ptyIsAlive(win.id).catch(() => false);
    dlog(`resume alive=${alive} autostart=${!!win.autostart} started=${!!win.started}`);
    if (alive) {
      await attach();
      return;
    }
    if (win.autostart && !win.started) {
      await spawnNew();
      return;
    }
    setOverlay({ kind: win.started ? "stopped" : "idle" });
  }, [attach, spawnNew, win.autostart, win.started, win.id]);

  const term = useTerminal({
    // A clicked link opens in our in-app browser pane; a double-clicked one in
    // the real system browser. Ctrl/Cmd+click also opens in-app (instant).
    onOpenLink: (uri, mode) => {
      if (mode === "external") {
        openExternal(uri).catch((e) => dlog(`openExternal failed: ${String(e)}`));
      } else {
        useStore.getState().addPane("browser", { url: uri });
      }
    },
    onData: (d) => {
      // Timestamp keystrokes for the smart border's echo suppression. An Enter
      // submits a prompt → the output that follows is real agent work.
      lastInputRef.current = Date.now();
      if (d.includes("\r") || d.includes("\n")) lastEnterRef.current = lastInputRef.current;
      if (startedRef.current) {
        ptyWrite(win.id, encodeUtf8(d)).catch(() => {});
      }
      feedSniffer(d);
    },
    onResize: ({ cols, rows }) => {
      sizeRef.current = { cols, rows };
      if (startedRef.current) ptyResize(win.id, rows, cols).catch(() => {});
    },
    onScrollChange: setAtBottom,
    onReady: (t) => {
      writeRef.current = (d) => t.write(d);
      screenTermRef.current = t;
      sizeRef.current = { cols: t.cols, rows: t.rows };
      readyRef.current = true;
      perfMeasure("terminal_mount_to_ready", performance.now() - mountedAtRef.current);
      perfEvent("terminal_ready", { id: win.id.slice(0, 8), cols: t.cols, rows: t.rows, visible });
      dlog(`onReady ${t.cols}x${t.rows}`);
      void resume();
    },
  });

  // Autostart can flip on *after* mount — e.g. "Tout reprendre" in the startup
  // resume dialog sets it once the pane is already rendered, so onReady's resume()
  // already ran with autostart still false. Spawn now that it's true.
  useEffect(() => {
    if (win.autostart) dlog(`autostart effect: ready=${readyRef.current} started=${startedRef.current}`);
    if (readyRef.current && win.autostart && !startedRef.current) void resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.autostart, resume]);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible || !readyRef.current) return;
    const chunks = hiddenChunksRef.current;
    const total = hiddenBytesRef.current;
    const truncated = hiddenTruncatedRef.current;
    if (!total && !truncated) return;

    clearHiddenOutput();
    if (!truncated) {
      const bytes = concatChunks(chunks, total);
      perfEvent("terminal_hidden_flush", { id: win.id.slice(0, 8), bytes: total });
      writeToTerm(bytes);
      return;
    }

    perfEvent("terminal_hidden_replay_backlog", { id: win.id.slice(0, 8), buffered: total });
    void ptyBacklog(win.id, BACKLOG_REPLAY_BYTES)
      .then((backlog) => {
        if (backlog?.length) {
          term.reset();
          writeToTerm(backlog);
        } else if (chunks.length) {
          writeToTerm(concatChunks(chunks, total));
        }
      })
      .catch(() => {
        if (chunks.length) writeToTerm(concatChunks(chunks, total));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, win.id, clearHiddenOutput, writeToTerm]);

  // Expose this pane's rendered screen text to the voice interpreter, so
  // read_terminal_context can ground a prompt in the agent's actual on-screen
  // state (cleaner than the raw PTY backlog of overlapping TUI frames).
  useEffect(() => registerTermReader(win.id, () => serializeTerminal(term.getTerm())), [win.id]);

  // The control center "go to this agent" jump asks the pane to grab the keyboard
  // (the jump also brings the window to front + warps the OS cursor onto it).
  useEffect(() => {
    return bus.on(`term:focus:${win.id}`, () => {
      setLastActiveTerminal(win.id);
      term.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.id, setLastActiveTerminal]);

  // Drop listeners on unmount but DO NOT kill the PTY: switching workspaces
  // unmounts the pane, and we want the agent to keep running in the background.
  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((off) => off());
      unlistenRef.current = [];
      subscribedRef.current = false;
      startedRef.current = false;
      cancelCaptureRef.current?.();
      cancelCaptureRef.current = null;
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(finishedTimer.current);
      window.clearTimeout(startSettleTimer.current);
      pasteTimers.current.forEach((id) => window.clearTimeout(id));
      clearHiddenOutput();
    };
  }, [clearHiddenOutput]);

  const handleImage = useCallback(
    async (dataUrl: string) => {
      try {
        // Show a 1s "loading" state, then the preview for 1s, then auto-hide.
        // Clicking anywhere dismisses it early (see onMouseDown below).
        clearPaste();
        setPaste({ thumb: dataUrl, cap: "", phase: "loading" });
        const path = await saveTempImage(dataUrl);
        if (startedRef.current) ptyWrite(win.id, encodeUtf8(`"${path}" `)).catch(() => {});
        const cap = `📎 ${baseName(path)} → ${win.title}`;
        pasteTimers.current.push(
          window.setTimeout(() => setPaste({ thumb: dataUrl, cap, phase: "ready" }), 1000),
          window.setTimeout(() => clearPaste(), 2000),
        );
      } catch {
        clearPaste();
      }
    },
    [win.id, win.title, clearPaste],
  );

  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = paneRef.current;
    const offPaste = el ? attachPasteImage(el, (dataUrl) => handleImage(dataUrl)) : () => {};
    const offBus = bus.on(`term:image:${win.id}`, (p: { dataUrl: string }) => handleImage(p.dataUrl));
    return () => {
      offPaste();
      offBus();
    };
  }, [handleImage, win.id]);

  // Capture-phase wheel listener: for agents (which swallow the wheel for their
  // own TUI scrollback, leaving xterm's onScroll silent), a scroll-up gesture is
  // the only signal that history is hidden below — surface the jump button.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (isAgentRef.current && e.deltaY < 0) setAgentScrolledUp(true);
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, []);

  // The jump arrow shows when the running CLI is an agent and the user scrolled
  // up (DOM-tracked), or — for plain shells — when xterm reports we left the
  // bottom of its scrollback.
  const runningDef = CLIS[win.runningCli ?? win.cli ?? "shell"];
  const showJump = runningDef.agent ? agentScrolledUp : !atBottom;

  // Send the running agent back to the live bottom. Ctrl+End (CSI 1;5F) is the
  // de-facto "jump to bottom" key for TUI agents (it's what Claude Code shows in
  // its own hint); harmless for any CLI that ignores it. scrollToBottom() covers
  // the plain-shell / normal-buffer case.
  const jumpToBottom = useCallback(() => {
    term.scrollToBottom();
    if (runningDef.agent && startedRef.current) {
      ptyWrite(win.id, encodeUtf8("\x1b[1;5F")).catch(() => {});
    }
    setAgentScrolledUp(false);
    term.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningDef.agent, win.id]);

  return (
    <div
      ref={paneRef}
      className="vato-pane-term"
      style={{ position: "absolute", inset: 0 }}
      onMouseDown={() => {
        if (paste) clearPaste();
        setLastActiveTerminal(win.id);
      }}
    >
      <div ref={term.containerRef} style={{ position: "absolute", inset: 0, padding: "6px 6px 6px 8px" }} />

      {showJump && (
        <button
          className="vato-scroll-bottom-btn vato-no-drag"
          title={t("term.scrollToBottom")}
          aria-label={t("term.scrollToBottom")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={jumpToBottom}
        >
          <ChevronDownIcon size={18} />
        </button>
      )}

      {paste && (
        <div className="vato-paste-overlay">
          {paste.phase === "loading" ? (
            <span className="vato-paste-spinner" aria-label={t("term.pastedImage")} />
          ) : (
            <>
              <img src={paste.thumb} alt={t("term.pastedImage")} />
              <span className="cap">{paste.cap}</span>
            </>
          )}
        </div>
      )}

      {overlay && (
        <div
          className="vato-term-overlay"
          style={{ ["--accent" as string]: def.color } as React.CSSProperties}
        >
          {overlay.error && <span className="msg">{overlay.error}</span>}
          <button className="vato-start-btn vato-no-drag" onClick={() => spawnNew()}>
            <def.Icon size={16} /> {t("term.start", { label: def.label })}
          </button>
        </div>
      )}
    </div>
  );
}
