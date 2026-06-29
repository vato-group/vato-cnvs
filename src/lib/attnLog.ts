// Structured tracer for the attention / notification pipeline (the "smart
// border" + OS pings). Diagnosing why a notification fired — or spammed — means
// reconstructing a chain of decisions across two files (TerminalPane for the
// active workspace, useAttentionWatch for background ones) and one OS shim
// (notify). This routes every decision into ONE timestamped stream so the whole
// A→Z flow reads top-to-bottom in a single place.
//
// Two sinks, always in lockstep:
//   • the shared debug file — debugLog() → %TEMP%/vato-cnvs/debug.log (+ console),
//     each line already prefixed with epoch-ms by the Rust sink.
//   • an in-memory ring (last RING_MAX events) so the recent trace can be dumped
//     on demand without hunting through the file.
//
// Runtime control, no rebuild needed — from the devtools console:
//   __attn.on()      enable tracing (persisted)        __attn.off()  disable
//   __attn.dump()    print the recent ring to console  __attn.clear()
import { debugLog } from "../pty";

const RING_MAX = 600;
const ring: string[] = [];

// Default ON: the user is actively debugging the notification flow. Persisted so
// a deliberate off/on survives reloads.
let enabled = (() => {
  try {
    return localStorage.getItem("vato.attnlog") !== "0";
  } catch {
    return true;
  }
})();

export function setAttnLog(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem("vato.attnlog", on ? "1" : "0");
  } catch {
    /* private mode / no storage — in-memory toggle still works */
  }
}

export function attnLogEnabled(): boolean {
  return enabled;
}

/** Recent attention events as one newline-joined block (oldest → newest). */
export function attnDump(): string {
  return ring.join("\n");
}

export function attnClear(): void {
  ring.length = 0;
}

// Render a field value compactly and on a single line (the file is line-oriented).
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "y" : "n";
  if (typeof v === "string") {
    const s = v.replace(/\s+/g, " ").trim();
    return /[\s=]/.test(s) ? JSON.stringify(s) : s;
  }
  return String(v);
}

/**
 * Record one decision in the attention pipeline.
 *   scope  — where it happened: "pane" (active), "bg" (watcher), "notify".
 *   event  — the decision: "active" | "finished" | "busy-hold" | "ping" | …
 *   fields — structured context (pane id, status, busy/waiting flags, screen tail).
 * Always appended to the ring; mirrored to the debug file only while enabled.
 */
export function attnLog(scope: string, event: string, fields?: Record<string, unknown>): void {
  const tail = fields
    ? " " +
      Object.entries(fields)
        .map(([k, v]) => `${k}=${fmt(v)}`)
        .join(" ")
    : "";
  const line = `[attn:${scope}] ${event}${tail}`;
  ring.push(line);
  if (ring.length > RING_MAX) ring.shift();
  if (enabled) debugLog(line);
}

/**
 * Compact snippet of the LAST non-blank line of a serialized screen — the line
 * that the busy/waiting matchers actually look at. Lets a trace show *why* a
 * screen was judged busy/finished without dumping the whole frame.
 */
export function tail(screen: string, max = 80): string {
  if (!screen) return "";
  const lines = screen.split("\n");
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      last = lines[i].trim();
      break;
    }
  }
  return last.length > max ? "…" + last.slice(last.length - max) : last;
}

// Console handle for live debugging. Guarded so a non-DOM runtime (tests) is fine.
try {
  (globalThis as unknown as { __attn?: unknown }).__attn = {
    on: () => setAttnLog(true),
    off: () => setAttnLog(false),
    enabled: attnLogEnabled,
    dump: () => {
      // eslint-disable-next-line no-console
      console.log(attnDump());
      return ring.length;
    },
    clear: attnClear,
  };
} catch {
  /* no global to attach to */
}
