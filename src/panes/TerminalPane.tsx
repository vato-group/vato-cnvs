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
import { attachPasteImage } from "../lib/clipboard";
import { registerTermReader, serializeTerminal } from "../voice/termAccess";
import { ChevronDownIcon } from "../ui/icons";
import { gt, useT } from "../i18n";
import { complete, learn, type Suggestion } from "../autocomplete/engine";

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

export function TerminalPane({ win }: { win: WindowItem }) {
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

  // ---- inline autocomplete (deterministic, offline) ----
  // Track the partial WORD the user is currently typing, sniffed straight from
  // their keystrokes — so it works for plain shells AND agent TUIs alike,
  // independent of how the program echoes. Tab accepts the highlighted suggestion
  // by writing its missing suffix to the PTY, exactly as if the user typed it.
  const acWord = useRef("");
  const acEsc = useRef(false);
  const acSuggRef = useRef<Suggestion[]>([]);
  const acActiveRef = useRef(0);
  const [acSugg, setAcSugg] = useState<Suggestion[]>([]);
  const [acActive, setAcActive] = useState(0);
  const [acToken, setAcToken] = useState("");

  const acClear = useCallback(() => {
    if (!acSuggRef.current.length) return;
    acSuggRef.current = [];
    acActiveRef.current = 0;
    setAcSugg([]);
  }, []);

  const acRefresh = useCallback(() => {
    const list = acWord.current.length >= 2 ? complete(acWord.current, 6) : [];
    acSuggRef.current = list;
    acActiveRef.current = 0;
    setAcSugg(list);
    setAcActive(0);
    setAcToken(acWord.current);
  }, []);

  // Rebuild the current word from the raw bytes the user sends to the PTY.
  const feedAc = useCallback(
    (data: string) => {
      for (const ch of data) {
        if (acEsc.current) {
          // Inside an escape sequence (arrows, history, etc.) → abandon the word.
          if (/[a-zA-Z~]/.test(ch)) acEsc.current = false;
          acWord.current = "";
        } else if (ch === "\x1b") {
          acEsc.current = true;
          acWord.current = "";
        } else if (ch === "\r" || ch === "\n" || ch === "\x03" || ch === "\x15" || ch === "\t") {
          acWord.current = ""; // submit / Ctrl-C / Ctrl-U / Tab → end the token
        } else if (ch === "\x7f" || ch === "\b") {
          acWord.current = acWord.current.slice(0, -1);
        } else if (/[A-Za-z0-9_-]/.test(ch)) {
          acWord.current += ch;
        } else {
          acWord.current = ""; // space / punctuation ends the token
        }
      }
      acRefresh();
    },
    [acRefresh],
  );

  const acceptAc = useCallback(
    (index?: number) => {
      const list = acSuggRef.current;
      if (!list.length || !startedRef.current) return false;
      const s = list[index ?? acActiveRef.current] ?? list[0];
      const suffix = s.text.slice(acWord.current.length);
      if (suffix) ptyWrite(win.id, encodeUtf8(suffix)).catch(() => {});
      learn(s.text);
      acWord.current = s.text;
      acClear();
      return true;
    },
    [win.id, acClear],
  );

  // First crack at every terminal keydown (before xterm forwards it to the PTY).
  // Tab accepts the top suggestion; Esc dismisses the popup but still reaches the
  // program. Arrows are left alone so shell history keeps working.
  const onTermKey = useCallback(
    (e: KeyboardEvent) => {
      if (!acSuggRef.current.length) return true;
      if (e.key === "Tab") {
        e.preventDefault();
        acceptAc();
        return false;
      }
      if (e.key === "Escape") acClear();
      return true;
    },
    [acceptAc, acClear],
  );

  // ---- intelligent-border state machine driven by output activity ----
  // Flip to the blue "finished" ring, then auto-clear it back to idle (no ring)
  // after 15s so an agent that's been done a while stops drawing attention.
  const markFinished = useCallback(() => {
    setStatus(win.id, "finished");
    window.clearTimeout(finishedTimer.current);
    finishedTimer.current = window.setTimeout(() => setStatus(win.id, "idle"), 15000);
  }, [setStatus, win.id]);

  const markActive = useCallback(() => {
    setStatus(win.id, "active");
    window.clearTimeout(idleTimer.current);
    window.clearTimeout(finishedTimer.current);
    idleTimer.current = window.setTimeout(markFinished, 800);
  }, [setStatus, win.id, markFinished]);

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
    markActive();
  }, [markActive, setStatus, win.id]);

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
      writeRef.current?.(bytes);
      onActivity();
      // First output from an agent = there's now a conversation worth resuming.
      // Persist it so the next app start relaunches this pane in resume mode.
      if (def.agent && !resumableMarkedRef.current) {
        resumableMarkedRef.current = true;
        dlog(`first output (${bytes.length}b) -> resumable`);
        updateWindow(win.id, { resumable: true });
      }
    });
    const offExit = await onPtyExit(win.id, () => {
      dlog("EXIT event");
      setStatus(win.id, "error");
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
  }, [onActivity, setStatus, updateWindow, def.agent, win.id]);

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
      await ptySpawn({ id: win.id, program: shellDef.program, args: shellDef.args, cwd: win.cwd, rows, cols, scopeHistory: true });
      nudgeRedraw();
    } catch (e) {
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
    setStatus(win.id, "idle");
    // Repaint the fresh xterm from the PTY's backlog. A full-screen TUI redraws
    // itself on the SIGWINCH below, but a plain shell never does — without the
    // replay it would stay black until the next keystroke ("noir au switch de
    // workspace, revient au scroll/Ctrl-C").
    const backlog = await ptyBacklog(win.id).catch(() => null);
    if (backlog && backlog.length) {
      dlog(`replay backlog ${backlog.length}b`);
      writeRef.current?.(backlog);
    }
    const { cols, rows } = sizeRef.current;
    ptyResize(win.id, rows, cols).catch(() => {});
    nudgeRedraw(); // belt-and-braces: force a TUI to repaint its alternate screen
  }, [subscribe, nudgeRedraw, updateWindow, setStatus, win.id]);

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
        feedAc(d);
      }
      feedSniffer(d);
    },
    onKeyEvent: onTermKey,
    onResize: ({ cols, rows }) => {
      sizeRef.current = { cols, rows };
      if (startedRef.current) ptyResize(win.id, rows, cols).catch(() => {});
    },
    onScrollChange: setAtBottom,
    onReady: (t) => {
      writeRef.current = (d) => t.write(d);
      sizeRef.current = { cols: t.cols, rows: t.rows };
      readyRef.current = true;
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
    };
  }, []);

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

      {acSugg.length > 0 && (
        <div className="vato-ac-bar vato-no-drag" onMouseDown={(e) => e.stopPropagation()}>
          {acSugg.map((s, i) => (
            <button
              key={s.text}
              className={`vato-ac-chip${i === acActive ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptAc(i);
                term.focus();
              }}
            >
              <b>{s.text.slice(0, acToken.length)}</b>
              {s.text.slice(acToken.length)}
            </button>
          ))}
          <span className="vato-ac-hint">⇥</span>
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
