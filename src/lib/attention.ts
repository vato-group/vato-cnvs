// Shared "does this terminal need me?" detection, used by both the active pane
// (reads the live xterm screen) and the cross-workspace watcher (reads the PTY
// backlog). When an agent goes quiet we look at the last lines for an interactive
// prompt — a y/n, a numbered choice, its idle input box — meaning it's YOUR turn
// ("waiting") rather than simply done ("finished"). Best-effort: a miss just shows
// the softer "finished" state, so accuracy is never load-bearing.

// STRONG "it's your turn" marks: an explicit interactive prompt the agent has
// parked on. These WIN over any busy hint — a permission prompt still shows the
// "Running 1 shell command…" header it's asking to run, and the numbered-choice
// footer says "Esc to cancel", neither of which means it's actually working.
const WAITING_STRONG: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\by\s*\/\s*n\b/i,
  /do you want/i,
  /proceed\?/i,
  /\ballow\b[^?\n]*\?/i,
  /press enter/i,
  /continue\?/i,
  /❯\s*\d/, // a numbered choice list (permission prompt)
  /esc to cancel/i, // permission-prompt footer
  /\bto amend\b/i, // …"Tab to amend" on the same footer
];

// WEAK waiting hint: the bare idle input box. A redraw race can momentarily paint
// a spinner over it, so this one DEFERS to a busy hint (unlike the strong prompts).
const WAITING_WEAK: RegExp[] = [
  /\? for shortcuts/i, // Claude Code's idle input box hint
];

// Marks of an agent that's *still working*, not done — even when its output has
// briefly gone quiet (a sub-agent / tool call is running, the model is thinking).
// These keep showing on screen during the lull, so seeing one means "mid-turn
// pause, not finished". This is what stops a pause from being mis-read as a
// finish and spamming a notification every time the agent stalls.
// NB: no generic "running…" here — Claude shows "Running 1 shell command…" as a
// header WHILE waiting for that command's approval, so it isn't a busy signal.
const BUSY_PATTERNS: RegExp[] = [
  /esc to interrupt/i, // Claude/Codex working footer
  /interrompre/i, // …localised (FR)
  /thinking[…\.]/i,
  /working[…\.]/i,
  /\(\s*\d+s\b/, // elapsed-time counter, e.g. "(45s · …"
  /↑\s*[\d.]+k?\s*tokens/i, // streaming token counter
];

// A "still working" footer only counts while output is genuinely live. Past this
// much silence the footer is a frozen leftover (the agent actually finished) — so
// callers settle instead of holding "active" forever. Must exceed the quiet
// windows that trigger a settle (800ms active / 1100ms background) plus a slow
// spinner's tick, but stay short enough that a real finish notifies promptly.
export const BUSY_FRESH_MS = 2000;

/**
 * Stable fingerprint of a settled screen, for de-duplicating notifications: two
 * settles with the same fingerprint are the same state (an idle TUI repainting,
 * a cursor blink) and must NOT ping twice. Normalises away the bits that change
 * without meaning — spinner glyphs, elapsed-time / token digits, whitespace — and
 * keeps only the last few content lines (where a prompt or "done" line lives).
 */
export function screenSig(screen: string): string {
  if (!screen) return "";
  const lines = screen
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines
    .slice(-8)
    .join("\n")
    .replace(/[✻✶✳✢✺⋆∗*·•◦↑↓❯➤▪▰▱]/g, "") // spinner / bullet / arrow glyphs
    .replace(/\d+/g, "#") // elapsed-time & token counters
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip ANSI / control noise from raw terminal bytes. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … BEL/ST
    .replace(/\x1b[@-Z\\-_]/g, "") // 2-char escapes
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""); // other controls (keep \t \n \r)
}

/**
 * True when the tail of a terminal screen shows the agent is STILL working — a
 * spinner footer, an "esc to interrupt" hint, an elapsed-time or token counter.
 * Used to tell a mid-turn pause (sub-agent running, model thinking) from a real
 * finish so the lull doesn't flip the border to "finished" or fire a notification.
 */
export function looksBusy(screen: string): boolean {
  if (!screen) return false;
  const tail = screen.split("\n").slice(-16).join("\n");
  return BUSY_PATTERNS.some((re) => re.test(tail));
}

/** True when the tail of a terminal screen looks parked on an interactive prompt. */
export function looksWaiting(screen: string): boolean {
  if (!screen) return false;
  const tail = screen.split("\n").slice(-16).join("\n");
  // An explicit prompt is unambiguous and wins even if a "working" header lingers
  // on screen (e.g. a permission prompt above its pending shell command).
  if (WAITING_STRONG.some((re) => re.test(tail))) return true;
  // Otherwise a visible spinner / interrupt hint means it's still working.
  if (looksBusy(screen)) return false;
  return WAITING_WEAK.some((re) => re.test(tail));
}
