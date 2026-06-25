// Registry so the voice interpreter can read a terminal's CLEAN visible text.
//
// read_terminal_context used to decode the raw PTY backlog, but TUI agents
// (Claude/Codex) repaint the whole screen on every frame, so the backlog is a
// pile of overlapping ANSI frames. Reading xterm's rendered buffer instead gives
// the actual on-screen text. Each TerminalPane registers a reader for its id.

import type { Terminal } from "@xterm/xterm";

type Reader = () => string;

const readers = new Map<string, Reader>();

/** Register a pane's screen reader; returns an unregister fn. */
export function registerTermReader(id: string, read: Reader): () => void {
  readers.set(id, read);
  return () => {
    if (readers.get(id) === read) readers.delete(id);
  };
}

/** Serialize the rendered xterm buffer (scrollback tail + viewport) to text. */
export function serializeTerminal(term: Terminal | null, maxLines = 160): string {
  if (!term) return "";
  const buf = term.buffer.active;
  const end = buf.length; // total rows incl. scrollback
  const start = Math.max(0, end - maxLines);
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const line = buf.getLine(i);
    out.push(line ? line.translateToString(true) : ""); // true = trim trailing blanks
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** The clean on-screen text of a terminal, or null if no reader is registered. */
export function readTermScreen(id: string): string | null {
  const r = readers.get(id);
  if (!r) return null;
  try {
    return r();
  } catch {
    return null;
  }
}
