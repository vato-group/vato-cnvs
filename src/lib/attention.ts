// Shared "does this terminal need me?" detection, used by both the active pane
// (reads the live xterm screen) and the cross-workspace watcher (reads the PTY
// backlog). When an agent goes quiet we look at the last lines for an interactive
// prompt — a y/n, a numbered choice, its idle input box — meaning it's YOUR turn
// ("waiting") rather than simply done ("finished"). Best-effort: a miss just shows
// the softer "finished" state, so accuracy is never load-bearing.

const WAITING_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\by\s*\/\s*n\b/i,
  /do you want/i,
  /proceed\?/i,
  /\ballow\b[^?\n]*\?/i,
  /press enter/i,
  /continue\?/i,
  /\? for shortcuts/i, // Claude Code's idle input box hint
  /❯\s*\d/, // a numbered choice list (permission prompt)
];

/** Strip ANSI / control noise from raw terminal bytes. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … BEL/ST
    .replace(/\x1b[@-Z\\-_]/g, "") // 2-char escapes
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""); // other controls (keep \t \n \r)
}

/** True when the tail of a terminal screen looks parked on an interactive prompt. */
export function looksWaiting(screen: string): boolean {
  if (!screen) return false;
  const tail = screen.split("\n").slice(-16).join("\n");
  // A visible spinner / interrupt hint means it's still working, not waiting.
  if (/esc to interrupt|interrompre|thinking…|working…/i.test(tail)) return false;
  return WAITING_PATTERNS.some((re) => re.test(tail));
}
