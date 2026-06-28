export type PaneKind = "terminal" | "browser" | "notes";

/**
 * Drives the "intelligent border" colour.
 *   • waiting → the agent went quiet on an interactive prompt (y/n, a question,
 *     its idle input box) — it's YOUR turn. Distinct from `finished` (done, no
 *     prompt detected) so the most urgent "answer me" case stands out and never
 *     auto-fades.
 */
export type AgentStatus = "idle" | "starting" | "active" | "waiting" | "finished" | "error";

export type CliId = "claude" | "codex" | "cursor" | "opencode" | "antigravity" | "shell";

export interface WindowItem {
  id: string;
  kind: PaneKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;

  // terminal-only
  cli?: CliId; // CLI this pane was spawned with (drives what `Démarrer` launches)
  runningCli?: CliId; // agent detected running *inside* the pane (display override; live, not persisted)
  cwd?: string;
  // The intelligent-border / attention state. The SINGLE source of truth for the
  // bell badge + jump-to-next: an agent counts as "wants you" while its status is
  // `waiting` (parked on a prompt — your turn) or `error`. `waiting` never fades;
  // it clears only when the agent resumes working (i.e. once you've answered).
  status?: AgentStatus;
  started?: boolean; // a PTY has been spawned this session
  autostart?: boolean; // spawn immediately on mount (fresh windows only; cleared on persist)
  // ---- conversation persistence (survives app restart) ----
  // Claude: an UUID generated at pane creation, forced via `--session-id` on the
  //   first launch then reused via `--resume`. Codex: discovered by scanning the
  //   CLI's session store after launch. Cursor: stays undefined (resumes the
  //   most recent chat via `--resume`).
  sessionId?: string;
  // True once the agent has a conversation worth resuming. Persisted, so on the
  // next app start `buildSpawnArgs` knows to relaunch in resume mode.
  resumable?: boolean;

  // browser-only
  url?: string;

  // notes-only — the pane's plain-text content (persisted).
  note?: string;
}

export type BackgroundKind = "color" | "image" | "video";

export interface Background {
  kind: BackgroundKind;
  value: string; // css color/gradient, or image/video url
  dim?: number; // 0..1 dark overlay
}

/** Saved snapshot of the Excalidraw viewport (scene <-> screen mapping). */
export interface View {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * Which panes the focus-mode grid lays out (per workspace):
 *   • "all"       → every pane (agents, plain shells, browsers)
 *   • "agents"    → CLI agent terminals only (cli ≠ "shell")
 *   • "terminals" → plain shell terminals only (cli === "shell")
 * Filtered-out panes stay mounted but hidden, so their PTY keeps running.
 */
export type FocusFilter = "all" | "agents" | "terminals";

export interface Workspace {
  id: string;
  name: string;
  windows: WindowItem[];
  view: View;
  /** Persisted Excalidraw scene elements (the drawings). */
  scene: any[];
  background: Background;
  cwd?: string; // default working dir for new terminals
  /** Which panes the focus-mode grid shows. Default "all" (treated as such when absent). */
  focusFilter?: FocusFilter;
}

/** Per-CLI launch configuration (flags chosen in Settings). */
export interface CliLaunchConfig {
  /** Toggled preset flags, by preset id. */
  presets: Record<string, boolean>;
  /** Raw extra arguments appended to the launch command. */
  extraArgs: string;
}

/** UI / assistant language of the whole app (English, French, Dutch). */
export type UiLang = "en" | "fr" | "nl";

/** How the mic is triggered. */
export type VoiceMode = "ptt" | "continuous";

export interface SttSettings {
  /** OpenAI transcription language code, or "auto". */
  lang: string;
  mode: VoiceMode;
  /** OpenAI cloud key (transcription + command interpreter). Stays local. */
  openaiKey: string;
  /**
   * `deviceId` of the chosen microphone, or "" for the system default. Lets the
   * user switch mics when the default is busy/missing (NotReadableError).
   */
  micDeviceId: string;
  /** Audio transcription model (gpt-4o-(mini-)transcribe / whisper-1). */
  openaiModel: string;
  /** Chat model that interprets spoken commands into actions. */
  commandModel: string;
  /** Continuous-VAD speech threshold (RMS). Lower = more sensitive mic. */
  vadThreshold: number;
  /** Require a wake word before acting (continuous mode only). */
  requireWakeWord: boolean;
  /** The wake word to listen for (e.g. "vato"). */
  wakeWord: string;
  /** Speak the assistant's replies aloud. */
  tts: boolean;
  /**
   * TTS backend. "browser" = the system Web Speech voices (free, offline);
   * "openai" = OpenAI cloud TTS (needs the key, higher quality, billed).
   */
  ttsEngine: "browser" | "openai";
  /** OpenAI TTS voice (alloy, echo, fable, onyx, nova, shimmer…). */
  ttsVoice: string;
  /** Chosen system voice (`voiceURI`) for the browser engine; "" = auto by app language. */
  ttsBrowserVoice: string;
}

export interface AppSettings {
  cli: Partial<Record<CliId, CliLaunchConfig>>;
  /** actionId -> key combo (e.g. "ctrl+1"). */
  shortcuts: Record<string, string>;
  stt: SttSettings;
  /** UI + assistant language for the whole app. */
  lang: UiLang;
}
