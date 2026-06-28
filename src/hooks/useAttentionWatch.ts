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
import { onPtyExit, onPtyOutput, ptyBacklog } from "../pty";
import { notify } from "../lib/notify";
import { looksWaiting, stripAnsi } from "../lib/attention";
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
    const keep = (p: Promise<UnlistenFn>) =>
      void p.then((off) => (cancelled ? off() : offs.push(off)));

    const ping = (id: string, title: string, cli: CliId, key: "waiting" | "finished" | "error") => {
      if (fired.has(id)) return;
      fired.add(id);
      if (!document.hasFocus()) notify(`${title} — ${CLIS[cli].label}`, gt(`notify.${key}`));
    };

    // Quiet after a burst: read the backlog to tell a parked prompt (waiting →
    // counts in the badge) from a plain done (settle to idle → doesn't nag).
    const settle = async (pane: { id: string; title: string; cli: CliId }) => {
      let waiting = false;
      try {
        const b = await ptyBacklog(pane.id);
        if (b) waiting = looksWaiting(stripAnsi(new TextDecoder().decode(b)));
      } catch {
        /* backlog read is best-effort */
      }
      if (cancelled) return;
      const status: AgentStatus = waiting ? "waiting" : "idle";
      setAnyStatus(pane.id, status);
      ping(pane.id, pane.title, pane.cli, waiting ? "waiting" : "finished");
    };

    for (const pane of bg) {
      keep(
        onPtyOutput(pane.id, () => {
          // New output = working again; re-arm the quiet timer and allow the next
          // settle to notify afresh.
          fired.delete(pane.id);
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
