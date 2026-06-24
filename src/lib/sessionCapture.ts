import { agentSessionId, ptyIsAlive } from "../pty";
import { SCANNABLE_SESSION } from "../data/clis";
import type { CliId } from "../types";

export interface CaptureOpts {
  paneId: string;
  cli: CliId;
  cwd?: string;
  /** Epoch ms of the spawn — only sessions touched after count. */
  startedAfterMs: number;
  /** Called once, when the conversation id is found. */
  onCaptured: (sessionId: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Poll the CLI's on-disk session store until the freshly-started conversation's
 * id appears, then report it once. A CLI doesn't always write its session file
 * immediately (Claude only after the first user message), so we keep polling
 * while the PTY is alive, up to a deadline.
 *
 * No-op for CLIs we can't scan (cursor/opencode/…) or when `cwd` is unknown —
 * those panes still resume via their "most recent" flag once `resumable` is set.
 * Returns a cancel fn.
 */
export function captureAgentSession(opts: CaptureOpts): () => void {
  const kind = SCANNABLE_SESSION[opts.cli];
  if (!kind || !opts.cwd) return () => {};

  const interval = opts.intervalMs ?? 2000;
  const deadline = opts.startedAfterMs + (opts.timeoutMs ?? 150_000);
  let cancelled = false;
  let timer: number | undefined;

  const tick = async () => {
    if (cancelled || Date.now() > deadline) return;
    if (!(await ptyIsAlive(opts.paneId).catch(() => false))) return; // agent gone
    const id = await agentSessionId(kind, opts.cwd!, opts.startedAfterMs).catch(() => null);
    if (cancelled) return;
    if (id) {
      opts.onCaptured(id);
      return;
    }
    timer = window.setTimeout(tick, interval);
  };

  timer = window.setTimeout(tick, interval);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
