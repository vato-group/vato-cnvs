// Autocomplete engine — the surface-agnostic core shared by every input in the
// app (Notes pane, Excalidraw text, terminals/agents). It answers two questions:
//   1. what partial word is the caret currently inside? (`currentToken`)
//   2. what should we suggest to complete it?            (`complete`)
//
// All suggestions come from the learned lexicon (see lexicon.ts) — deterministic,
// offline, free. `learn` is re-exported so callers feed accepted/typed text back
// in to make the next suggestion smarter.

import { learn as learnLex, suggest as suggestLex } from "./lexicon";

export interface Suggestion {
  /** The full word to insert. */
  text: string;
}

/** Minimum partial-word length before we offer suggestions. */
export const MIN_TOKEN = 2;

// A "word" the user is typing: starts with a letter, then letters/digits/_/-.
// Matches the lexicon's token shape so completions line up with what's learned.
const TOKEN_BEFORE = /[A-Za-z][\w-]*$/;

/**
 * The partial word immediately before the caret, and where it starts.
 * `textBeforeCaret` is the input value up to the caret position.
 */
export function currentToken(textBeforeCaret: string): { token: string; start: number } {
  const m = textBeforeCaret.match(TOKEN_BEFORE);
  if (!m) return { token: "", start: textBeforeCaret.length };
  return { token: m[0], start: m.index ?? textBeforeCaret.length };
}

/** Ranked completions for a partial word, or [] when too short / nothing fits. */
export function complete(token: string, limit = 6): Suggestion[] {
  if (token.length < MIN_TOKEN) return [];
  return suggestLex(token, limit).map((text) => ({ text }));
}

export const learn = learnLex;
