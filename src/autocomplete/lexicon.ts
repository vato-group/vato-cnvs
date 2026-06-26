// Learned-vocabulary store — the "brain" of the deterministic, offline
// autocomplete. A frecency-ranked set of the words the user types across every
// surface (notes, whiteboard text, terminals/agents), persisted to localStorage.
//
// There is NO AI and NO network here: suggestions are just the words you've used
// before, ranked by how often AND how recently you used them ("frecency"). That's
// what makes it feel smart with zero cost — after a short while it completes YOUR
// vocabulary: project names, agent names, file names, recurring prompt phrases.
//
// A small curated SEED primes the very first session (CLI/shell commands, common
// code + English/French words) so completion works before anything is learned;
// learned words quickly outrank the seed.

const KEY = "vato-cnvs-lexicon";
const MAX = 5000; // cap the stored set; evict the lowest-frecency entries
const SAVE_DEBOUNCE = 1500;
const MIN_LEARN = 3; // don't bother remembering 1–2 char tokens

interface Entry {
  /** Display form (first-seen casing), used verbatim when suggested. */
  w: string;
  /** Times seen. */
  c: number;
  /** Last-seen epoch ms (drives the recency half of frecency). */
  t: number;
}

/** key (lowercased word) -> entry */
const words = new Map<string, Entry>();
let loaded = false;
let saveTimer: number | undefined;

// Curated first-run vocabulary. Kept deliberately small — it only has to make
// the feature useful on a fresh install; everything else is learned. Mixed
// case is intentional (camelCase identifiers complete as written).
const SEED = [
  // app / agents
  "vato", "canvas", "workspace", "agent", "terminal", "browser", "claude", "codex",
  "cursor", "opencode", "antigravity", "shell",
  // shell / dev commands
  "git", "commit", "push", "pull", "branch", "checkout", "merge", "rebase", "status",
  "clone", "fetch", "stash", "diff", "log", "npm", "pnpm", "yarn", "node", "python",
  "pip", "cargo", "rustc", "docker", "build", "install", "run", "dev", "start", "test",
  "lint", "format", "deploy", "serve", "watch", "clear", "list", "remove", "create",
  // programming words
  "function", "const", "return", "import", "export", "interface", "async", "await",
  "component", "useState", "useEffect", "useRef", "useMemo", "useCallback", "props",
  "state", "value", "error", "result", "config", "settings", "window", "message",
  "prompt", "response", "request", "update", "delete", "render", "handle", "listen",
  "string", "number", "boolean", "object", "array", "promise", "default", "current",
  "params", "options", "context", "provider", "callback", "element", "selector",
  "implement", "implementation", "refactor", "feature", "version", "example",
  // common English
  "the", "and", "for", "with", "this", "that", "from", "your", "please", "should",
  "would", "could", "because", "before", "after", "change", "file", "files", "folder",
  "directory", "project", "following", "between", "instead", "without", "already",
  // common French (default UI language)
  "bonjour", "merci", "fichier", "fichiers", "dossier", "projet", "fonction",
  "créer", "ajouter", "modifier", "supprimer", "corriger", "exemple", "paramètres",
  "problème", "parce", "pour", "avec", "dans", "comme", "faire", "voici", "peux",
  "peut", "alors", "ensuite", "maintenant", "lancer", "afficher", "réessayer",
];

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, [string, number, number]>;
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) words.set(k, { w: v[0], c: v[1], t: v[2] });
      }
    }
  } catch {
    /* corrupt store — start clean */
  }
  // Prime the seed once (only words not already learned), with a low baseline so
  // a single real use outranks it.
  const t = Date.now();
  for (const w of SEED) {
    const k = w.toLowerCase();
    if (!words.has(k)) words.set(k, { w, c: 1, t: t - 30 * 86400000 });
  }
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, SAVE_DEBOUNCE);
}

function save(): void {
  // Evict to MAX by lowest frecency first.
  if (words.size > MAX) {
    const now = Date.now();
    const ranked = [...words.entries()].sort(
      (a, b) => frecency(b[1], now) - frecency(a[1], now),
    );
    words.clear();
    for (const [k, v] of ranked.slice(0, MAX)) words.set(k, v);
  }
  const obj: Record<string, [string, number, number]> = {};
  for (const [k, v] of words) obj[k] = [v.w, v.c, v.t];
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* quota — ignore */
  }
}

/** frecency = recent uses count for much more than old ones. */
function frecency(e: Entry, now: number): number {
  const ageDays = (now - e.t) / 86400000;
  return e.c / (1 + ageDays / 7);
}

const TOKEN_RE = /[A-Za-z][\w-]*/g;

/** Feed text (a whole note, a typed word, a command) so its words are learned. */
export function learn(text: string): void {
  if (!text) return;
  load();
  const now = Date.now();
  const seen = text.match(TOKEN_RE);
  if (!seen) return;
  for (const tok of seen) {
    if (tok.length < MIN_LEARN) continue;
    const k = tok.toLowerCase();
    const e = words.get(k);
    if (e) {
      e.c += 1;
      e.t = now;
    } else {
      words.set(k, { w: tok, c: 1, t: now });
    }
  }
  scheduleSave();
}

/**
 * Words that start with `prefix` (case-insensitive), best frecency first.
 * Excludes the prefix itself. Returns display forms.
 */
export function suggest(prefix: string, limit: number): string[] {
  load();
  const p = prefix.toLowerCase();
  if (!p) return [];
  const now = Date.now();
  const hits: { w: string; s: number }[] = [];
  for (const [k, e] of words) {
    if (k.length <= p.length || !k.startsWith(p)) continue;
    hits.push({ w: e.w, s: frecency(e, now) });
  }
  hits.sort((a, b) => b.s - a.s);
  return hits.slice(0, limit).map((h) => h.w);
}
