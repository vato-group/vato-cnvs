// Cross-workspace attention watcher.
//
// A TerminalPane only exists (and only listens to its PTY) while ITS workspace is
// active — switching away unmounts the pane but the agent keeps running. So an
// agent that parks on a prompt in a *background* workspace would otherwise raise
// no badge and fire no notification. This hook fills that gap: it subscribes to
// the PTY output/exit streams of every terminal NOT in the active workspace and,
// when one goes quiet (or exits), sets its status — which is the single source of
// truth for the bell badge (waiting/error) — and, if the app is backgrounded,
// pings the OS. To tell "waiting for input" from a plain "done" it sniffs the PTY
// backlog (no live xterm here to read). The active workspace's panes are handled
// by TerminalPane itself, so the two never overlap.
import { useEffect, useMemo } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { CLIS } from "../data/clis";
import type { AgentStatus, CliId } from "../types";
import { onPtyExit, onPtyOutputSignal, ptyBacklog } from "../pty";
import { notify } from "../lib/notify";
import { BUSY_FRESH_MS, looksBusy, looksWaiting, screenSig, stripAnsi } from "../lib/attention";
import { attnLog, tail } from "../lib/attnLog";
import { gt } from "../i18n";

// A background agent is silent between turns; this much quiet after a burst counts
// as "its turn is done". Longer than the active-pane 800ms since we settle from the
// backlog, not a live screen — we only want the settled state, not mid-stream pauses.
const QUIET_MS = 1100;

export function useAttentionWatch() {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const setAnyStatus = useStore((s) => s.setAnyStatus);

  // Terminal panes living outside the active workspace (id + label for the notice).
  const bg = useMemo(() => {
    const list: { id: string; title: string; cli: CliId }[] = [];
    for (const w of workspaces) {
      if (w.id === activeId) continue;
      for (const win of w.windows)
        if (win.kind === "terminal")
          list.push({ id: win.id, title: win.title, cli: win.runningCli ?? win.cli ?? "shell" });
    }
    return list;
  }, [workspaces, activeId]);

  // Only re-subscribe when the SET of watched panes changes, not on every store
  // write (this hook's own status updates churn `workspaces`).
  const sig = bg.map((p) => p.id).join(",");

  useEffect(() => {
    let cancelled = false;
    const offs: UnlistenFn[] = [];
    const timers = new Map<string, number>();
    const fired = new Set<string>(); // one notification per attention episode
    const settled = new Map<string, { fingerprint: string; status: AgentStatus }>();
    const lastOutput = new Map<string, number>(); // last PTY byte time, per pane
    const keep = (p: Promise<UnlistenFn>) =>
      void p.then((off) => (cancelled ? off() : offs.push(off)));

    const ping = (id: string, title: string, cli: CliId, key: "waiting" | "finished" | "error") => {
      const focused = document.hasFocus();
      const decision = fired.has(id) ? "skip-dup" : focused ? "skip-focus" : "fire";
      attnLog("bg", "ping", { pane: id.slice(0, 8), title, key, notify: decision, focused });
      if (fired.has(id)) return;
      fired.add(id);
      if (!focused) notify(`${title} — ${CLIS[cli].label}`, gt(`notify.${key}`));
    };

    // Quiet after a burst: read the backlog to tell a parked prompt (waiting →
    // counts in the badge) from a plain done (settle to idle → doesn't nag).
    const settle = async (pane: { id: string; title: string; cli: CliId }) => {
      let screen = "";
      try {
        const b = await ptyBacklog(pane.id, 64 * 1024);
        if (b) screen = stripAnsi(new TextDecoder().decode(b));
      } catch {
        /* backlog read is best-effort */
      }
      if (cancelled) return;
      const fingerprint = screenSig(screen);
      const previous = settled.get(pane.id);
      const sameSettled = !!previous && previous.fingerprint === fingerprint;
      // The backlog went quiet, but a working footer (spinner / "esc to interrupt"
      // / elapsed counter) is still on screen — the agent only PAUSED mid-turn (a
      // sub-agent or tool call is running), it isn't done. Keep it "active", re-check
      // after another quiet window, and DON'T ping (this was the notification spam).
      // ...but only while output is genuinely live. Once the PTY has been silent
      // past BUSY_FRESH_MS the footer is a frozen leftover (the agent really
      // finished) — fall through and settle instead of holding "active" forever
      // (the stuck "in progress, no notification" bug).
      const silentFor = Date.now() - (lastOutput.get(pane.id) ?? 0);
      if (looksBusy(screen) && silentFor < BUSY_FRESH_MS) {
        if (!sameSettled) fired.delete(pane.id);
        attnLog("bg", "busy-hold", { pane: pane.id.slice(0, 8), title: pane.title, silentMs: silentFor, tail: tail(screen) });
        setAnyStatus(pane.id, "active");
        window.clearTimeout(timers.get(pane.id));
        timers.set(pane.id, window.setTimeout(() => void settle(pane), QUIET_MS));
        return;
      }
      const waiting = looksWaiting(screen);
      const status: AgentStatus = waiting ? "waiting" : "idle";
      attnLog("bg", waiting ? "waiting" : "finished", {
        pane: pane.id.slice(0, 8),
        title: pane.title,
        repaint: sameSettled && previous?.status === status,
        tail: tail(screen),
      });
      setAnyStatus(pane.id, status);
      if (sameSettled && previous?.status === status) return;
      settled.set(pane.id, { fingerprint, status });
      fired.delete(pane.id);
      ping(pane.id, pane.title, pane.cli, waiting ? "waiting" : "finished");
    };

    for (const pane of bg) {
      keep(
        onPtyOutputSignal(pane.id, () => {
          lastOutput.set(pane.id, Date.now());
          // New output re-arms the quiet timer. Do not clear `fired` here: TUI
          // agents often repaint an unchanged idle screen, and clearing on raw
          // output made each repaint fire another "finished" notification.
          // `settle()` clears it only after the settled screen actually changes.
          window.clearTimeout(timers.get(pane.id));
          timers.set(pane.id, window.setTimeout(() => void settle(pane), QUIET_MS));
        }),
      );
      keep(
        onPtyExit(pane.id, () => {
          window.clearTimeout(timers.get(pane.id));
          setAnyStatus(pane.id, "error");
          ping(pane.id, pane.title, pane.cli, "error");
        }),
      );
    }

    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      timers.forEach((t) => window.clearTimeout(t));
    };
    // `bg` entries are addressed by the stable `sig`; titles/cli of a background
    // pane don't change (no input reaches it), so the captured labels stay valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, activeId, setAnyStatus]);
}
