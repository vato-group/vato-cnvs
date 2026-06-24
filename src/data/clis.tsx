import type { ReactNode } from "react";
import type { CliId, CliLaunchConfig } from "../types";

/** A one-click launch flag toggle shown in Settings (e.g. "Bypass permissions"). */
export interface CliPreset {
  id: string;
  label: string;
  flag: string;
}

export interface CliDef {
  id: CliId;
  label: string;
  /** Program name resolved on PATH (handles .exe/.cmd/.ps1 in the Rust backend). */
  program: string;
  args: string[];
  /** Accent colour for icon + active glow. */
  color: string;
  /** Is this an AI agent (vs a plain shell)? */
  agent: boolean;
  /** Optional preset launch flags shown in Settings. */
  presets?: CliPreset[];
  Icon: (p: { size?: number }) => ReactNode;
}

const s = (size = 18) => ({ width: size, height: size, viewBox: "0 0 24 24" });

const ClaudeIcon = ({ size = 18 }) => (
  <svg {...s(size)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
  </svg>
);

const CodexIcon = ({ size = 18 }) => (
  <svg {...s(size)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <polygon points="12,2.5 20.5,7.25 20.5,16.75 12,21.5 3.5,16.75 3.5,7.25" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
  </svg>
);

const CursorIcon = ({ size = 18 }) => (
  <svg {...s(size)} fill="currentColor">
    <path d="M5 3 L19.5 11.5 L12.6 12.7 L9.4 19.6 Z" />
  </svg>
);

const OpenCodeIcon = ({ size = 18 }) => (
  <svg {...s(size)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6.5 L3.5 12 L9 17.5" />
    <path d="M15 6.5 L20.5 12 L15 17.5" />
  </svg>
);

const AntigravityIcon = ({ size = 18 }) => (
  <svg {...s(size)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M7.5 13.5 L12 7.5 L16.5 13.5" />
    <line x1="12" y1="7.5" x2="12" y2="16.5" />
  </svg>
);

const ShellIcon = ({ size = 18 }) => (
  <svg {...s(size)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 7 L9.5 11.5 L5 16" />
    <line x1="11.5" y1="16.5" x2="18" y2="16.5" />
  </svg>
);

export const CLIS: Record<CliId, CliDef> = {
  claude: {
    id: "claude", label: "Claude Code", program: "claude", args: [], color: "#D97757", agent: true, Icon: ClaudeIcon,
    presets: [
      { id: "bypass", label: "Bypass permissions", flag: "--dangerously-skip-permissions" },
      { id: "continue", label: "Reprendre la session", flag: "--continue" },
    ],
  },
  codex: {
    id: "codex", label: "Codex", program: "codex", args: [], color: "#10A37F", agent: true, Icon: CodexIcon,
    presets: [
      { id: "fullauto", label: "Full auto", flag: "--full-auto" },
      { id: "bypass", label: "Bypass approbations + sandbox", flag: "--dangerously-bypass-approvals-and-sandbox" },
    ],
  },
  cursor: { id: "cursor", label: "Cursor", program: "cursor-agent", args: [], color: "#6CA0FF", agent: true, Icon: CursorIcon },
  opencode: { id: "opencode", label: "OpenCode", program: "opencode", args: [], color: "#A78BFA", agent: true, Icon: OpenCodeIcon },
  antigravity: { id: "antigravity", label: "Antigravity", program: "antigravity", args: [], color: "#F472B6", agent: true, Icon: AntigravityIcon },
  shell: { id: "shell", label: "Shell", program: "powershell.exe", args: ["-NoLogo"], color: "#8B95A1", agent: false, Icon: ShellIcon },
};

/** Display/menu order. */
export const CLI_ORDER: CliId[] = ["claude", "codex", "cursor", "opencode", "antigravity", "shell"];

/** Program name (first token of a typed command) -> the agent CLI it launches. */
const PROGRAM_TO_CLI: Record<string, CliId> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  "cursor-agent": "cursor",
  opencode: "opencode",
  antigravity: "antigravity",
};

/** Strip path prefix + .exe/.cmd/.bat/.ps1 and lowercase a single token. */
const normProgram = (t: string) =>
  (t.split(/[\\/]/).pop() ?? t).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();

/**
 * Detect which agent CLI a typed shell command launches, or null if none.
 * Handles a direct invocation (`claude …`) and a leading package runner
 * (`npx codex`, `bunx opencode`, `pnpm dlx cursor-agent`).
 */
export function detectAgentCommand(line: string): CliId | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let idx = 0;
  const head = normProgram(tokens[0]);
  if (head === "npx" || head === "bunx" || head === "pnpx") idx = 1;
  else if (head === "pnpm" && tokens[1]?.toLowerCase() === "dlx") idx = 2;

  const prog = tokens[idx] ? normProgram(tokens[idx]) : "";
  const cli = PROGRAM_TO_CLI[prog];
  return cli && CLIS[cli].agent ? cli : null;
}

/** Split a raw args string into argv, respecting simple single/double quotes. */
export function parseArgs(s: string): string[] {
  const matches = s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((a) => a.replace(/^["']|["']$/g, ""));
}

/** Build the final argv for a CLI from its definition + the user's launch config. */
export function buildCliArgs(def: CliDef, cfg?: CliLaunchConfig): string[] {
  const presetFlags = (def.presets ?? [])
    .filter((p) => cfg?.presets?.[p.id])
    .map((p) => p.flag);
  return [...def.args, ...presetFlags, ...parseArgs(cfg?.extraArgs ?? "")];
}

/** The conversation-persistence state of a pane, read from the store. */
export interface SessionState {
  /** Stable conversation id (Claude: forced; Codex: discovered; else undefined). */
  sessionId?: string;
  /** Has a previous conversation we should resume into? */
  resumable?: boolean;
}

/**
 * Build the argv to spawn a CLI, injecting its **resume** flag when the pane
 * already has a conversation. A PTY can't be re-attached after the app closes,
 * so "persistence" means relaunching the CLI on the same conversation:
 *
 *   Claude : `--session-id <uuid>` on the first launch (we own the id), then
 *            `--resume <uuid>` on resume; `--continue` if no id is known.
 *   Codex  : `resume <id>` if discovered, else `resume --last`.
 *   Cursor : `--resume=<id>` if known, else `--resume` (most recent chat).
 *   Others : no known resume mechanism — plain restart.
 *
 * The user's preset/extra args are always appended. The Claude `--continue`
 * preset (Settings) is dropped here in resume mode to avoid a conflicting flag.
 */
export function buildSpawnArgs(def: CliDef, cfg: CliLaunchConfig | undefined, sess: SessionState): string[] {
  const user = buildCliArgs(def, cfg);
  const resume = !!sess.resumable;

  switch (def.id) {
    case "claude": {
      // Avoid passing both --continue (preset) and --session-id/--resume.
      const userNoContinue = user.filter((a) => a !== "--continue");
      if (sess.sessionId) {
        return resume
          ? ["--resume", sess.sessionId, ...userNoContinue]
          : ["--session-id", sess.sessionId, ...userNoContinue];
      }
      return resume ? ["--continue", ...userNoContinue] : user;
    }
    case "codex":
      if (resume) return sess.sessionId ? ["resume", sess.sessionId, ...user] : ["resume", "--last", ...user];
      return user;
    case "cursor":
      if (resume) return sess.sessionId ? [`--resume=${sess.sessionId}`, ...user] : ["--resume", ...user];
      return user;
    default:
      return user;
  }
}

/** CLIs whose session id can be discovered by scanning their on-disk store. */
export const SCANNABLE_SESSION: Partial<Record<CliId, "claude" | "codex">> = {
  claude: "claude",
  codex: "codex",
};
