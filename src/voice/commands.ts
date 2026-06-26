// Spoken-command interpreter: a transcript -> structured actions that drive the
// cockpit (create agents, instruct terminals, switch workspaces).
//
// It runs an OpenAI tool-calling loop. The model is given a snapshot of the
// current workspace + a small toolbox and decides which tools to call; we
// execute each tool against the Zustand store / PTY and feed the result back
// until the model emits a final confirmation. Everything goes through the Rust
// `openai_chat` proxy so the key never touches the JS bundle and there's no CORS.
import { useStore } from "../store";
import { CLIS, CLI_ORDER } from "../data/clis";
import type { CliId, WindowItem } from "../types";
import { ptyBacklog, ptyIsAlive, ptyKill } from "../pty";
import { injectToTerminal } from "./useVoice";
import { openaiChat } from "./stt";
import { readTermScreen } from "./termAccess";
import { getLang, LANG_NATIVE } from "../i18n";

export interface CommandResult {
  /** Short, human-facing confirmation of what was done (model's final reply). */
  summary: string;
  /** Ordered log of the actions actually executed. */
  steps: string[];
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ----------------------------- store helpers ---------------------------- */

function activeWs() {
  const s = useStore.getState();
  return s.workspaces.find((w) => w.id === s.activeId) ?? s.workspaces[0];
}

function listTerminals(): WindowItem[] {
  return (activeWs()?.windows ?? []).filter((w) => w.kind === "terminal");
}

/** A terminal pane with the workspace it lives in. */
interface TermEntry {
  win: WindowItem;
  wsId: string;
  wsName: string;
  active: boolean;
}

/** Every terminal across ALL workspaces (their PTYs run even when not visible). */
function allTerminals(): TermEntry[] {
  const s = useStore.getState();
  return s.workspaces.flatMap((w) =>
    w.windows
      .filter((x) => x.kind === "terminal")
      .map((win) => ({ win, wsId: w.id, wsName: w.name, active: w.id === s.activeId })),
  );
}

/* ---------------------- fuzzy / phonetic name matching ------------------- */
// Voice transcription mangles short proper names: "Zane" comes back as "Zyn",
// "Jett" as "Jet"/"Jette", "Codex" as "Codecs". Exact/substring matching then
// fails. We add a tolerant fallback combining edit distance with a consonant
// "skeleton" (a poor man's phonetic key) — names that SOUND alike usually share
// their consonants ("zane" & "zyn" → both "zn"), which is the strongest signal.

/** Lowercase, strip accents & punctuation → bare a-z0-9. */
function normName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9]/g, "");
}

/** Consonant skeleton: drop vowels (incl. y) so homophones collapse together. */
function skeleton(s: string): string {
  return normName(s)
    .replace(/(.)\1+/g, "$1") // de-double ("jette" → "jete")
    .replace(/[aeiouy]/g, "");
}

/** Levenshtein edit distance (iterative, single row). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Similarity in [0,1+] of two names: edit-distance ratio, boosted when the
 *  consonant skeletons match and when the first letters agree. */
function nameSimilarity(query: string, candidate: string): number {
  const a = normName(query);
  const b = normName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const levSim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const sa = skeleton(a);
  const sb = skeleton(b);
  const skelMatch = sa.length >= 2 && sa === sb ? 0.9 : 0; // strong phonetic signal
  const firstBonus = a[0] === b[0] ? 0.1 : 0;
  return Math.max(levSim, skelMatch) + firstBonus;
}

/** Best-effort match of a spoken terminal name to a pane, across all spaces. */
function resolveTerminal(name: string): TermEntry | null {
  const all = allTerminals();
  if (!all.length) return null;
  const q = (name ?? "").trim().toLowerCase();
  if (!q || ["active", "current", "last", "this", "it", "him", "lui", "ça", "ca", "celui-ci", "ce terminal"].includes(q)) {
    const lastId = useStore.getState().lastActiveTerminalId;
    return all.find((e) => e.win.id === lastId) ?? all.find((e) => e.active) ?? all[0];
  }
  // On ties, prefer the active workspace.
  const ranked = [...all].sort((a, b) => Number(b.active) - Number(a.active));
  const title = (e: TermEntry) => e.win.title.toLowerCase();
  const cli = (e: TermEntry) => (e.win.runningCli ?? e.win.cli ?? "").toLowerCase();
  const exact =
    ranked.find((e) => title(e) === q) ??
    ranked.find((e) => cli(e) === q) ??
    ranked.find((e) => title(e).includes(q) || q.includes(title(e))) ??
    ranked.find((e) => title(e).startsWith(q));
  if (exact) return exact;

  // Nothing matched literally → tolerate transcription errors. Pick the closest
  // name by fuzzy/phonetic similarity, but only if it's confidently close.
  let best: TermEntry | null = null;
  let bestScore = 0;
  for (const e of ranked) {
    const score = Math.max(nameSimilarity(q, title(e)), nameSimilarity(q, cli(e)));
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  // 0.6 keeps "zyn"→"zane" (~1.0) and "jet"→"jett" (~1.0) while rejecting
  // unrelated names. With a single terminal open we relax to 0.45 (the user is
  // almost certainly talking about the only agent there is).
  const threshold = all.length === 1 ? 0.45 : 0.6;
  return bestScore >= threshold ? best : null;
}

/** Strip ANSI / control noise from raw terminal bytes for the model to read. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … BEL/ST
    .replace(/\x1b[@-Z\\-_]/g, "") // 2-char escapes
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""); // other controls (keep \t \n \r)
}

async function readContext(id: string, maxChars = 2600): Promise<string> {
  // Prefer the clean RENDERED xterm screen (TUI agents repaint every frame, so
  // the raw PTY backlog is a pile of overlapping ANSI frames). Falls back to the
  // backlog when the pane is unmounted (e.g. terminal in another workspace).
  let text = (readTermScreen(id) ?? "").trim();
  if (!text) {
    const bytes = await ptyBacklog(id).catch(() => null);
    if (bytes && bytes.length) {
      text = stripAnsi(new TextDecoder().decode(bytes))
        .split("\n")
        .map((l) => l.replace(/\s+$/g, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  }
  if (!text) return "(aucune sortie pour l'instant)";
  return text.length > maxChars ? "…" + text.slice(-maxChars) : text;
}

/** Wait until a freshly-spawned PTY is alive (it spawns async on pane mount). */
async function waitAlive(id: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ptyIsAlive(id).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
}

/* ------------------------------- the tools ------------------------------ */

const AGENT_CLIS = CLI_ORDER.filter((id) => id !== "shell"); // claude/codex/cursor/opencode/antigravity
const CLI_ENUM = [...AGENT_CLIS, "shell"] as CliId[];

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_terminals",
      description:
        "List the open terminals/agents in the active workspace with their name, CLI and live status. Call this if you're unsure which terminal the user means.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_terminal_context",
      description:
        "Read the recent visible output of a terminal so you understand its current state before instructing it. Use it whenever the user says to 'watch'/'look at'/'check' a terminal or its context.",
      parameters: {
        type: "object",
        properties: {
          terminal: {
            type: "string",
            description: "Terminal name (e.g. 'jett'), or 'active' for the last-focused one.",
          },
        },
        required: ["terminal"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_to_terminal",
      description:
        "Type a message/prompt into a terminal (usually an agent) and press Enter. This is how you instruct a running agent. By default, craft `text` as a well-engineered prompt (clear, specific, actionable, grounded in the terminal's context) — do NOT just echo the user's spoken words. Send verbatim only when the user explicitly asks (\"exactly\", \"word for word\") or when the target is a plain shell command.",
      parameters: {
        type: "object",
        properties: {
          terminal: { type: "string", description: "Target terminal name, or 'active'." },
          text: { type: "string", description: "The exact text/prompt to send." },
          submit: {
            type: "boolean",
            description: "Press Enter to submit (default true). Set false to TYPE the text WITHOUT sending — e.g. the user wants to prepare/review a message before sending it.",
          },
        },
        required: ["terminal", "text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_terminal",
      description:
        "Press Enter in a terminal to SEND/submit whatever is already typed in its input box, WITHOUT adding any new text. Use when the user says 'envoie', 'envoie le message', 'valide', 'appuie sur entrée', 'send it', 'go' about a terminal that already holds the text to send.",
      parameters: {
        type: "object",
        properties: {
          terminal: { type: "string", description: "Target terminal name, or 'active'." },
        },
        required: ["terminal"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_agent",
      description:
        "Open a new terminal running an agent CLI. Optionally send an initial prompt once it's ready.",
      parameters: {
        type: "object",
        properties: {
          cli: { type: "string", enum: CLI_ENUM, description: "Which CLI to launch." },
          title: { type: "string", description: "Optional custom name for the terminal." },
          prompt: { type: "string", description: "Optional first prompt to send once it's ready." },
        },
        required: ["cli"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_focus_mode",
      description:
        "Toggle or set the focus/grid mode — the SAME thing as the Ctrl+G shortcut. It gathers the active workspace's windows into a tidy 1:1 grid (or releases them back to the free layout). Use for 'active/désactive le mode focus', 'regroupe/disperse les fenêtres'.",
      parameters: {
        type: "object",
        properties: {
          on: {
            type: "boolean",
            description: "true = enter the focus grid, false = leave it. Omit to toggle.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_terminal",
      description:
        "Close/kill a terminal or agent: stops its process and removes its window. Use for 'ferme l'agent jett', 'ferme ce terminal', 'ferme tout'. Closing 'all' is destructive and needs confirmation: call it first WITHOUT confirm, relay the confirmation message, and only re-call with confirm=true once the user says yes.",
      parameters: {
        type: "object",
        properties: {
          terminal: {
            type: "string",
            description: "Terminal name, 'active' for the last-focused one, or 'all' to close every terminal.",
          },
          confirm: {
            type: "boolean",
            description: "Only for 'all': set true to actually proceed, after the user has confirmed.",
          },
        },
        required: ["terminal"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_listening_mode",
      description:
        "Set how the mic is triggered: 'continuous' (always listening, hands-free) or 'ptt' (push-to-talk). Use when the user says 'passe en écoute continue', 'active le mode continu', 'écoute en continu', or 'repasse en push-to-talk'.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["continuous", "ptt"], description: "The trigger mode to set." },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_terminal",
      description: "Rename a terminal/agent (its display title). Use for 'renomme jett en backend'.",
      parameters: {
        type: "object",
        properties: {
          terminal: { type: "string", description: "Current terminal name, or 'active'." },
          name: { type: "string", description: "The new name." },
        },
        required: ["terminal", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fullscreen_terminal",
      description:
        "Put a terminal/agent fullscreen, or exit fullscreen. Use for 'mets jett en plein écran', 'quitte le plein écran'.",
      parameters: {
        type: "object",
        properties: {
          terminal: { type: "string", description: "Terminal name or 'active'. Omit/ignored when on=false." },
          on: { type: "boolean", description: "true = fullscreen the terminal, false = exit fullscreen. Default true." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_browser",
      description: "Open an in-app browser pane, optionally at a URL. Use for 'ouvre un navigateur', 'ouvre github.com'.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Optional URL to open (e.g. 'github.com')." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_workspace",
      description: "Create a new workspace and switch to it. Use for 'crée un nouveau workspace', 'nouvel espace'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional workspace name." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_conversation",
      description:
        "Forget the voice conversation history (start fresh). Use for 'oublie', 'nouvelle conversation', 'on recommence'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "switch_workspace",
      description:
        "Switch the active workspace. For relative navigation pass exactly 'next' or 'prev' (the user saying 'suivant'/'prochain' = 'next'; 'précédent' = 'prev') — same as the Ctrl+Alt+→/← shortcut. Otherwise pass an exact workspace name or its 1-based number.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "'next', 'prev', a workspace name, or a 1-based index.",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  },
];

/* ----------------------------- tool executor ---------------------------- */

const settleMs = (cli: CliId) => (CLIS[cli].agent ? 2500 : 400);

/** Create the agent synchronously (return its name now); send the optional first
 * prompt in the BACKGROUND once its PTY is alive — so "create 3 agents and prompt
 * each" doesn't block the loop ~3×(spawn+settle) seconds. */
function spawnAgentAndPrompt(cli: CliId, title: string | undefined, prompt: string | undefined): { name: string } {
  const s = useStore.getState();
  const id = s.addTerminal(cli);
  if (title?.trim()) s.updateWindow(id, { title: title.trim() });
  const name =
    useStore.getState().workspaces.flatMap((w) => w.windows).find((w) => w.id === id)?.title ?? title ?? cli;
  if (prompt?.trim()) {
    void (async () => {
      const alive = await waitAlive(id);
      if (!alive) return;
      await sleep(settleMs(cli)); // let the CLI's TUI settle before typing
      await injectToTerminal(id, prompt.trim(), true).catch(() => {});
    })();
  }
  return { name };
}

async function execTool(name: string, argsJson: string, steps: string[]): Promise<string> {
  let args: any = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return JSON.stringify({ error: "arguments JSON invalides" });
  }

  switch (name) {
    case "list_terminals": {
      const terms = listTerminals().map((t) => ({
        name: t.title,
        cli: t.runningCli ?? t.cli ?? "shell",
        status: t.status ?? "idle",
      }));
      return JSON.stringify({ workspace: activeWs()?.name, terminals: terms });
    }

    case "read_terminal_context": {
      const t = resolveTerminal(args.terminal);
      if (!t) return JSON.stringify({ error: `terminal introuvable: ${args.terminal}` });
      const alive = await ptyIsAlive(t.win.id).catch(() => false);
      const context = alive ? await readContext(t.win.id) : "(terminal inactif)";
      steps.push(`Lu le contexte de « ${t.win.title} »`);
      return JSON.stringify({ terminal: t.win.title, workspace: t.wsName, alive, context });
    }

    case "send_to_terminal": {
      const t = resolveTerminal(args.terminal);
      if (!t) return JSON.stringify({ error: `terminal introuvable: ${args.terminal}` });
      const submit = args.submit !== false;
      const wasAlive = await ptyIsAlive(t.win.id).catch(() => false);
      const alive = wasAlive || (await waitAlive(t.win.id, 8000));
      if (!alive) return JSON.stringify({ error: `terminal « ${t.win.title} » inactif` });
      // Just spawned (we had to wait for it) → let the CLI's TUI settle so the
      // first keystrokes aren't swallowed during init.
      if (!wasAlive) await sleep(settleMs(t.win.runningCli ?? t.win.cli ?? "shell"));
      try {
        await injectToTerminal(t.win.id, String(args.text ?? ""), submit);
        steps.push(
          submit
            ? `Envoyé à « ${t.win.title} » : ${String(args.text ?? "").slice(0, 60)}`
            : `Préparé (non envoyé) dans « ${t.win.title} » : ${String(args.text ?? "").slice(0, 60)}`,
        );
        return JSON.stringify({ ok: true, terminal: t.win.title, submitted: submit });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    }

    case "submit_terminal": {
      const t = resolveTerminal(args.terminal);
      if (!t) return JSON.stringify({ error: `terminal introuvable: ${args.terminal}` });
      const alive = (await ptyIsAlive(t.win.id).catch(() => false)) || (await waitAlive(t.win.id, 8000));
      if (!alive) return JSON.stringify({ error: `terminal « ${t.win.title} » inactif` });
      try {
        // Just press Enter: send the carriage return with no new text, submitting
        // whatever is already typed in the terminal/agent input box.
        await injectToTerminal(t.win.id, "", true);
        steps.push(`Entrée (envoi) dans « ${t.win.title} »`);
        return JSON.stringify({ ok: true, terminal: t.win.title, submitted: true });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    }

    case "create_agent": {
      const cli = (CLI_ENUM.includes(args.cli) ? args.cli : "shell") as CliId;
      const res = spawnAgentAndPrompt(cli, args.title, args.prompt);
      steps.push(`Créé ${CLIS[cli].label} « ${res.name} »${args.prompt ? " + prompt" : ""}`);
      return JSON.stringify({ ok: true, name: res.name });
    }

    case "close_terminal": {
      const s = useStore.getState();
      const q = String(args.terminal ?? "").trim().toLowerCase();
      if (["all", "tout", "tous", "toutes"].includes(q)) {
        const all = allTerminals();
        if (!all.length) return JSON.stringify({ error: "aucun terminal à fermer" });
        // Destructive + bulk → require explicit confirmation (mis-hearing "ferme
        // tout" should not nuke every agent). The model relays the message; the
        // user confirms; the model recalls this with confirm=true.
        if (args.confirm !== true) {
          return JSON.stringify({
            needs_confirmation: true,
            count: all.length,
            message: `${all.length} terminal(aux) seront fermés (processus tués). Confirme en disant "oui, ferme tout".`,
          });
        }
        for (const e of all) {
          await ptyKill(e.win.id).catch(() => {});
          s.removeAnyWindow(e.win.id);
        }
        steps.push(`Fermé ${all.length} terminal(aux)`);
        return JSON.stringify({ ok: true, closed: all.map((e) => e.win.title) });
      }
      const t = resolveTerminal(args.terminal);
      if (!t) return JSON.stringify({ error: `terminal introuvable: ${args.terminal}` });
      // Kill the process first (removing the window alone would orphan the PTY).
      await ptyKill(t.win.id).catch(() => {});
      s.removeAnyWindow(t.win.id);
      steps.push(`Fermé « ${t.win.title} »`);
      return JSON.stringify({ ok: true, closed: t.win.title });
    }

    case "set_focus_mode": {
      const s = useStore.getState();
      const next = typeof args.on === "boolean" ? args.on : !s.focusMode;
      // Exactly the Ctrl+G action: the store's zen-grid focus toggle.
      s.setFocusMode(next);
      steps.push(next ? "Mode focus activé" : "Mode focus désactivé");
      return JSON.stringify({ ok: true, focusMode: next });
    }

    case "switch_workspace": {
      const s = useStore.getState();
      const list = s.workspaces;
      if (!list.length) return JSON.stringify({ error: "aucun workspace" });
      const n = list.length;
      const idx = list.findIndex((w) => w.id === s.activeId);
      const target = String(args.target ?? "next").trim().toLowerCase();

      // Relative move — same logic as the workspace.next/prev shortcut. Accept
      // EN + FR synonyms (the transcript / model may say "suivant", "prochain"…).
      const NEXT = ["next", "suivant", "suivante", "prochain", "prochaine", "forward", "+1", ">"];
      const PREV = ["prev", "previous", "précédent", "precedent", "précédente", "precedente", "avant", "arrière", "arriere", "back", "-1", "<"];
      const relative = NEXT.includes(target) || PREV.includes(target);
      // Only one workspace → a relative move would silently stay put. Report it
      // truthfully instead of pretending a switch happened.
      if (relative && n <= 1) {
        return JSON.stringify({
          noop: true,
          message: "Il n'y a qu'un seul workspace ouvert — aucun autre vers lequel basculer.",
        });
      }
      let next: typeof list[number] | undefined;
      if (NEXT.includes(target)) next = list[(idx + 1 + n) % n];
      else if (PREV.includes(target)) next = list[(idx - 1 + n) % n];
      else {
        // Pure number → 1-based workspace index.
        const num = target.match(/^\d+$/) ? parseInt(target, 10) : NaN;
        if (!Number.isNaN(num) && num >= 1 && num <= n) next = list[num - 1];
        else
          next =
            list.find((w) => w.name.toLowerCase() === target) ??
            list.find((w) => w.name.toLowerCase().includes(target));
      }
      if (!next) return JSON.stringify({ error: `workspace introuvable: ${args.target}` });
      s.setActive(next.id);
      steps.push(`Workspace → « ${next.name} »`);
      return JSON.stringify({ ok: true, workspace: next.name });
    }

    case "set_listening_mode": {
      const mode = args.mode === "continuous" ? "continuous" : "ptt";
      useStore.getState().setStt({ mode });
      steps.push(mode === "continuous" ? "Écoute continue activée" : "Push-to-talk activé");
      return JSON.stringify({ ok: true, mode });
    }

    case "rename_terminal": {
      const t = resolveTerminal(args.terminal);
      if (!t) return JSON.stringify({ error: `terminal introuvable: ${args.terminal}` });
      const newName = String(args.name ?? "").trim();
      if (!newName) return JSON.stringify({ error: "nom vide" });
      useStore.getState().updateAnyWindow(t.win.id, { title: newName });
      steps.push(`Renommé « ${t.win.title} » → « ${newName} »`);
      return JSON.stringify({ ok: true, from: t.win.title, to: newName });
    }

    case "fullscreen_terminal": {
      const s = useStore.getState();
      if (args.on === false) {
        s.setFullscreen(null);
        steps.push("Plein écran quitté");
        return JSON.stringify({ ok: true, fullscreen: false });
      }
      const t = resolveTerminal(args.terminal);
      if (!t) return JSON.stringify({ error: `terminal introuvable: ${args.terminal}` });
      if (!t.active) s.setActive(t.wsId); // fullscreen only renders on the active workspace
      s.setFullscreen(t.win.id);
      steps.push(`Plein écran : « ${t.win.title} »`);
      return JSON.stringify({ ok: true, fullscreen: true, terminal: t.win.title });
    }

    case "open_browser": {
      let url = String(args.url ?? "").trim();
      if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
      const id = useStore.getState().addPane("browser", url ? { url } : undefined);
      steps.push(url ? `Navigateur ouvert : ${url}` : "Navigateur ouvert");
      return JSON.stringify({ ok: true, id, url: url || undefined });
    }

    case "create_workspace": {
      const name = String(args.name ?? "").trim() || undefined;
      useStore.getState().addWorkspace({ name });
      steps.push(`Workspace créé${name ? ` « ${name} »` : ""}`);
      return JSON.stringify({ ok: true, workspace: name ?? "(nouveau)" });
    }

    case "reset_conversation": {
      clearVoiceHistory();
      steps.push("Conversation oubliée");
      return JSON.stringify({ ok: true });
    }

    default:
      return JSON.stringify({ error: `outil inconnu: ${name}` });
  }
}

/* ------------------------------- the loop ------------------------------- */

function snapshot(): string {
  const s = useStore.getState();
  const ws = activeWs();
  const spaces = s.workspaces.map((w) => w.name).join(", ") || "(aucun)";
  const terms = listTerminals();
  const termList = terms.length
    ? terms.map((t) => `- ${t.title} (${t.runningCli ?? t.cli ?? "shell"}, ${t.status ?? "idle"})`).join("\n")
    : "(aucun terminal ouvert)";
  // Terminals living in OTHER workspaces (still addressable by name — their PTYs run).
  const others = allTerminals().filter((e) => !e.active);
  const othersList = others.length
    ? "\nTerminaux dans d'autres workspaces (adressables par nom):\n" +
      others.map((e) => `- ${e.win.title} (${e.win.runningCli ?? e.win.cli ?? "shell"}) @ ${e.wsName}`).join("\n")
    : "";
  return [
    `Workspace actif: ${ws?.name ?? "?"}`,
    `Mode focus (grille Ctrl+G) actuellement: ${s.focusMode ? "ACTIF" : "inactif"}`,
    `Mode d'écoute micro actuel: ${s.settings.stt.mode === "continuous" ? "écoute continue" : "push-to-talk (ptt)"}`,
    `Tous les workspaces: ${spaces}`,
    `Terminaux du workspace actif:\n${termList}${othersList}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `Tu es l'assistant de pilotage vocal de "Vato Canvas", un cockpit multi-agents qui fait tourner plusieurs CLI d'IA (claude, codex, cursor, opencode) et des shells dans des fenêtres-terminaux, réparties en workspaces.

L'utilisateur te parle (transcription vocale, souvent en français, parfois approximative). Traduis son intention en appels d'outils :
- Pour instruire un agent existant (ex: "va voir l'agent jett et dis-lui de réessayer") : si pertinent lis d'abord son contexte avec read_terminal_context, puis envoie l'instruction avec send_to_terminal.
- RÉSUMER / EXPLIQUER un terminal (ex: "résume-moi ce qu'a fait jett", "qu'est-ce qui se passe sur codex", "explique-moi où il en est", "fais le point") : lis son contexte avec read_terminal_context, PUIS réponds toi-même par un résumé clair — N'envoie RIEN au terminal, c'est une question pour TOI. Ta réponse sera LUE À VOIX HAUTE : rédige en prose parlée, naturelle, sans jargon ANSI ni blocs de code ni chemins bruts ; va à l'essentiel (ce qu'il a fait, où il en est, erreur/blocage éventuel, prochaine étape). 1 à 4 phrases selon la richesse du contexte. Si plusieurs terminaux sont visés ("résume tout", "fais le point sur tous"), lis-les un par un puis fais une synthèse courte par terminal.
- PROMPT ENGINEERING (comportement PAR DÉFAUT quand la cible est un agent — claude/codex/cursor/opencode) : ne recopie PAS bêtement la phrase dictée. REFORMULE l'intention en un bon prompt : clair, spécifique, actionnable, qui intègre le contexte pertinent du terminal (ce que l'agent vient de faire, l'erreur ou la dernière suggestion à l'écran), énonce la tâche et le résultat attendu, et reste concis (pas de remplissage). Ex: l'utilisateur dit "dis-lui de réessayer" alors qu'un build a échoué => envoie un prompt du genre "Le build a échoué avec : <erreur observée>. Corrige la cause racine puis relance la compilation et confirme que ça passe." Rédige dans la langue de l'utilisateur (ou celle du projet si elle est évidente dans le contexte). Ce même soin s'applique au champ "prompt" de create_agent.
- EXCEPTION verbatim : si l'utilisateur dit "écris exactement", "mot pour mot", "copie-colle ceci", ou dicte un message précis à transmettre tel quel => mets ce texte dans "text" SANS rien reformuler, traduire ni ajouter. Idem pour une commande shell explicite, ou si la cible est un shell (cli "shell") et pas un agent : envoie la commande telle quelle.
- ÉCRIRE SANS ENVOYER puis ENVOYER : si l'utilisateur veut préparer/relire un message avant de l'envoyer ("écris ... mais n'envoie pas encore", "prépare le message", "tape ... sans valider") => send_to_terminal avec submit=false (le texte est tapé mais PAS validé). Ensuite, quand il dit "envoie", "envoie le message", "valide", "appuie sur entrée", "go" => appelle submit_terminal (ça fait juste Entrée pour envoyer ce qui est déjà dans la zone de saisie, sans rien retaper). "envoie le msg" = submit_terminal sur le terminal concerné (PAS un nouveau send_to_terminal), sauf si un nouveau contenu est explicitement dicté.
- Pour "crée N agents ..." : appelle create_agent pour chacun (avec le bon cli), et si l'utilisateur demande de leur envoyer une consigne, rédige-la (bien, cf. prompt engineering) dans le champ prompt de create_agent (ou via send_to_terminal).
- Pour "ferme/quitte/tue l'agent X" ou "ferme ce terminal" : close_terminal (target = nom ou "active"). Pour "ferme tout" : close_terminal target="all" SANS confirm d'abord ; relaie le message de confirmation renvoyé ; rappelle close_terminal target="all" confirm=true UNIQUEMENT quand l'utilisateur confirme ("oui", "ferme tout", "vas-y").
- Pour "renomme X en Y" : rename_terminal. Pour "mets X en plein écran" / "quitte le plein écran" : fullscreen_terminal. Pour "ouvre un navigateur"/"ouvre <url>" : open_browser. Pour "crée un workspace"/"nouvel espace" : create_workspace. Pour "oublie"/"nouvelle conversation" : reset_conversation.
- Pour "passe/change au workspace suivant/précédent" : switch_workspace.
- Pour "active/désactive le mode focus" ou "regroupe/disperse les fenêtres" : set_focus_mode (c'est exactement le raccourci Ctrl+G — la grille zen). Omets "on" pour basculer, ou mets-le explicitement selon la demande.
- Pour "passe en écoute continue"/"active le mode continu" ou "repasse en push-to-talk" : set_listening_mode (mode="continuous"|"ptt"). Le mode continu existe et reste dispo ; tu peux l'activer toi-même quand l'utilisateur le demande.
- Les terminaux d'AUTRES workspaces sont adressables par leur nom (read/send/submit/close/rename marchent dessus, leur PTY tourne même sans être affiché).

NOMS DE TERMINAUX — la transcription vocale déforme SOUVENT les noms propres courts (ex: "Zane" entendu "Zyn"/"Zen", "Jett" → "Jet"/"Jette", "Codex" → "Codecs"). Ne refuse JAMAIS sous prétexte qu'aucun terminal ne porte EXACTEMENT le nom entendu : choisis systématiquement celui dont le nom est le plus proche phonétiquement (mêmes consonnes, sonorité proche) et agis. Passe le nom entendu tel quel à l'outil (terminal: "...") — le résolveur fait lui-même un rapprochement flou/phonétique et te renverra une erreur seulement s'il n'y a vraiment aucune correspondance plausible. S'il n'y a qu'un seul agent ouvert, une commande qui vise "un agent" le vise quasi certainement : agis dessus sans hésiter. Ne demande une précision que si plusieurs noms sont également proches ET que le choix change le résultat. Sois efficace, enchaîne les outils nécessaires sans demander de confirmation (SAUF "ferme tout", qui exige la confirmation décrite plus haut). Quand tout est fait, réponds COURTEMENT (une phrase) dans la langue de l'utilisateur, sauf si on t'a demandé un résumé/une explication d'un terminal : dans ce cas donne le résumé parlé décrit plus haut (1 à 4 phrases). Dans tous les cas, ta réponse est lue à voix haute — reste naturel et sans détails techniques superflus.

IMPORTANT — honnêteté : ne prétends JAMAIS avoir fait une action qui a échoué. Si un outil renvoie {"error": ...} ou {"noop": ..., "message": ...}, dis-le clairement à l'utilisateur (ex: s'il n'y a qu'un seul workspace, réponds "Il n'y a qu'un seul workspace ouvert.") au lieu d'inventer un succès.

MÉMOIRE — tu disposes de l'historique des échanges récents (commandes précédentes, ce que tu as envoyé, à quel terminal). Sers-t'en pour résoudre les références au contexte antérieur : "le msg", "le même", "renvoie-lui", "lui", "cet agent", "ce que je viens de dire", "comme avant", etc. Si une référence reste VRAIMENT ambiguë (ex: "envoie le msg" alors qu'aucun message précis n'a été défini avant), demande une courte précision (ex: "Quel message ?") au lieu de deviner ou d'inventer.`;

/* ----------------------------- conversation memory ---------------------------- */
// In-memory, session-scoped history so follow-ups ("renvoie-lui", "le msg", "le
// même") resolve against earlier turns. Stored as whole turns (user + assistant
// + tool messages) so we never split a tool_call/tool-result pairing when trimming.
const MAX_HISTORY_TURNS = 6;
const HISTORY_TOOL_CAP = 600;
let history: any[][] = [];

/** Forget the voice-command conversation (start fresh). */
export function clearVoiceHistory() {
  history = [];
}

/** Cap a stored tool message's content so the rolling history stays bounded. */
function capStored(m: any): any {
  if (m.role === "tool" && typeof m.content === "string" && m.content.length > HISTORY_TOOL_CAP) {
    return { ...m, content: m.content.slice(0, HISTORY_TOOL_CAP) + "…(tronqué)" };
  }
  return m;
}

// Serialize commands: two close-together utterances (continuous mode) must NOT
// run overlapping tool loops or interleave the shared `history`.
let commandQueue: Promise<unknown> = Promise.resolve();

/** Interpret a spoken transcript and execute the resulting actions (queued). */
export function runVoiceCommand(transcript: string): Promise<CommandResult> {
  const run = commandQueue.then(() => runVoiceCommandImpl(transcript));
  commandQueue = run.catch(() => {});
  return run;
}

async function runVoiceCommandImpl(transcript: string): Promise<CommandResult> {
  const stt = useStore.getState().settings.stt;
  const apiKey = stt.openaiKey.trim();
  const steps: string[] = [];
  if (!apiKey) return { summary: "", steps, error: "Clé API OpenAI manquante" };

  // This turn's messages — appended to `history` at the end so the NEXT command
  // sees what was just said/done. The system+snapshot is always rebuilt fresh
  // (never stored) so the model reasons over the current state.
  const turn: any[] = [{ role: "user", content: transcript }];
  // Pin the assistant + the prompts it writes to agents to the app's chosen
  // language, regardless of the spoken language (verbatim/explicit-language
  // requests still win, per the system prompt).
  const langName = LANG_NATIVE[getLang()];
  const langDirective = `\n\n--- Langue de l'application ---\nLangue choisie dans l'app : ${langName}. Réponds TOUJOURS à l'utilisateur dans cette langue. Quand tu rédiges un prompt pour un agent (send_to_terminal / create_agent), écris-le AUSSI dans cette langue et demande à l'agent d'y répondre — sauf demande explicite contraire ou texte verbatim.`;
  const messages: any[] = [
    { role: "system", content: `${SYSTEM_PROMPT}${langDirective}\n\n--- État courant ---\n${snapshot()}` },
    ...history.flat(),
    ...turn,
  ];
  const remember = () => {
    history.push(turn.map(capStored));
    if (history.length > MAX_HISTORY_TURNS) history = history.slice(-MAX_HISTORY_TURNS);
  };

  try {
    for (let i = 0; i < 12; i++) {
      const raw = await openaiChat(apiKey, {
        model: stt.commandModel || "gpt-4o-mini",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0,
        parallel_tool_calls: false,
      });
      const data = JSON.parse(raw);
      const msg = data?.choices?.[0]?.message;
      if (!msg) return { summary: "", steps, error: "Réponse OpenAI vide" };

      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        const summary = (msg.content ?? "").trim() || (steps.length ? steps[steps.length - 1] : "Fait.");
        turn.push({ role: "assistant", content: msg.content ?? summary });
        remember();
        return { summary, steps };
      }

      // Replay the assistant turn, then execute each tool and append its result.
      messages.push(msg);
      turn.push(msg);
      for (const c of calls) {
        const result = await execTool(c.function?.name, c.function?.arguments ?? "{}", steps);
        const toolMsg = { role: "tool", tool_call_id: c.id, content: result };
        messages.push(toolMsg);
        turn.push(toolMsg);
      }
    }
    remember();
    return { summary: steps.length ? steps.join(" · ") : "Terminé.", steps };
  } catch (e) {
    return { summary: "", steps, error: String(e) };
  }
}
