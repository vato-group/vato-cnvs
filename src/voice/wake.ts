// Wake-word gating for continuous mode: only act on an utterance that starts
// with (a close variant of) the wake word, so ambient speech near the mic
// doesn't trigger commands. Push-to-talk bypasses this (the hold IS the intent).

/** Lowercase, strip accents + punctuation, collapse spaces. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance (small strings) — tolerates a 1-char transcription slip. */
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Is token `a` a close enough match for the wake word `w`? */
function close(a: string, w: string): boolean {
  if (!a) return false;
  if (a === w) return true;
  if ((a.startsWith(w) || w.startsWith(a)) && Math.abs(a.length - w.length) <= 2) return true;
  return lev(a, w) <= 1;
}

/**
 * If `text` begins with the wake word (allowing a leading "hey/ok …" filler),
 * return the COMMAND that follows. Returns "" when only the wake word was said,
 * and null when no wake word is present (→ ignore the utterance).
 */
export function stripWakeWord(text: string, wake: string): string | null {
  const w = norm(wake);
  if (!w) return text.trim(); // no wake word configured → everything passes
  const orig = (text ?? "").trim();
  if (!orig) return null;
  const tokens = orig.split(/\s+/);
  for (let i = 0; i < Math.min(3, tokens.length); i++) {
    if (close(norm(tokens[i]), w)) {
      return tokens
        .slice(i + 1)
        .join(" ")
        .replace(/^[\s,.:;!?–—-]+/, "")
        .trim();
    }
  }
  return null;
}
