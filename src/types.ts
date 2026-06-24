export type PaneKind = "terminal" | "browser";

/** Drives the "intelligent border" colour. */
export type AgentStatus = "idle" | "starting" | "active" | "finished" | "error";

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

export interface Workspace {
  id: string;
  name: string;
  windows: WindowItem[];
  view: View;
  /** Persisted Excalidraw scene elements (the drawings). */
  scene: any[];
  background: Background;
  cwd?: string; // default working dir for new terminals
}

/** Per-CLI launch configuration (flags chosen in Settings). */
export interface CliLaunchConfig {
  /** Toggled preset flags, by preset id. */
  presets: Record<string, boolean>;
  /** Raw extra arguments appended to the launch command. */
  extraArgs: string;
}

/** Local speech-to-text engine (sidecar driven). */
export type SttEngine = "whisper" | "parakeet" | "openai";

/** How the mic is triggered. */
export type VoiceMode = "ptt" | "continuous";

export interface SttSettings {
  engine: SttEngine;
  /** Whisper language code, or "auto". Parakeet is English-only. */
  lang: string;
  mode: VoiceMode;
  /** Write each transcribed segment straight into the target terminal. */
  directInsert: boolean;
  /** Optional explicit paths (else resolved from the app-data stt/ dir + PATH). */
  whisperBinary: string;
  whisperModel: string;
  parakeetBinary: string;
  /** OpenAI cloud transcription (audio API). Key stays local; never committed. */
  openaiKey: string;
  openaiModel: string;
}

export interface AppSettings {
  cli: Partial<Record<CliId, CliLaunchConfig>>;
  /** actionId -> key combo (e.g. "ctrl+1"). */
  shortcuts: Record<string, string>;
  stt: SttSettings;
}
