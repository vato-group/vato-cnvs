import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AgentStatus,
  AppSettings,
  Background,
  CliId,
  PaneKind,
  SttSettings,
  View,
  WindowItem,
  Workspace,
} from "./types";
import { randomName } from "./data/names";
import { computeTiles, spawnRectNear } from "./canvas/tiling";
import { deleteSceneFiles } from "./canvas/sceneFiles";
import { IS_MAC } from "./lib/platform";

/**
 * Base keyboard shortcuts (actionId -> combo, see canvas/shortcuts.ts).
 * Written with the Windows/Linux convention (`ctrl` as primary modifier);
 * `DEFAULT_SHORTCUTS` adapts them to macOS below.
 */
const BASE_SHORTCUTS: Record<string, string> = {
  "tool.selection": "v",
  "tool.hand": "h",
  "tool.rectangle": "r",
  "tool.diamond": "d",
  "tool.ellipse": "o",
  "tool.arrow": "a",
  "tool.line": "l",
  "tool.freedraw": "p",
  "tool.text": "t",
  "tool.image": "9",
  "tool.eraser": "e",
  "agent.claude": "ctrl+1",
  "agent.codex": "ctrl+2",
  "agent.cursor": "ctrl+3",
  "agent.opencode": "ctrl+4",
  "agent.shell": "ctrl+5",
  "pane.browser": "ctrl+b",
  "layout.tile": "ctrl+g",
  "view.focus": "ctrl+0",
  "workspace.new": "ctrl+shift+n",
  "workspace.next": "ctrl+alt+arrowright",
  "workspace.prev": "ctrl+alt+arrowleft",
  "workspace.overview": "ctrl+shift+g",
  "window.close": "ctrl+w",
  "window.fullscreen": "f11",
  "settings.open": "ctrl+,",
};

/**
 * Adapt a base combo to macOS: the primary modifier becomes Cmd (`meta`), and
 * F11 (taken by Mission Control on macOS) maps to the standard Cmd+Shift+F.
 * Modifiers are re-emitted in the canonical order produced by `comboFromEvent`
 * (ctrl, alt, shift, meta) so the stored combo matches a live keystroke.
 */
const MOD_ORDER = ["ctrl", "alt", "shift", "meta"];
function macCombo(actionId: string, combo: string): string {
  const mapped = actionId === "window.fullscreen" ? "meta+shift+f" : combo.replace(/\bctrl\b/g, "meta");
  const parts = mapped.split("+");
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  const keys = parts.filter((p) => !MOD_ORDER.includes(p));
  return [...mods, ...keys].join("+");
}

/** Default keyboard shortcuts, adapted to the host platform. */
export const DEFAULT_SHORTCUTS: Record<string, string> = IS_MAC
  ? Object.fromEntries(Object.entries(BASE_SHORTCUTS).map(([id, c]) => [id, macCombo(id, c)]))
  : BASE_SHORTCUTS;

export const DEFAULT_STT: SttSettings = {
  engine: "whisper",
  lang: "auto",
  mode: "ptt",
  directInsert: false,
  whisperBinary: "",
  whisperModel: "",
  parakeetBinary: "",
  openaiKey: "",
  openaiModel: "gpt-4o-mini-transcribe",
};

const DEFAULT_SETTINGS: AppSettings = {
  cli: {},
  shortcuts: { ...DEFAULT_SHORTCUTS },
  stt: { ...DEFAULT_STT },
};

export const DEFAULT_BG: Background = {
  kind: "color",
  value: "radial-gradient(1200px 820px at 72% 8%, #1c2c4d 0%, #0b0d12 62%)",
  dim: 0,
};

let wsCounter = 0;
function makeWorkspace(name?: string, cwd?: string): Workspace {
  wsCounter += 1;
  return {
    id: crypto.randomUUID(),
    name: name ?? `Workspace ${wsCounter}`,
    windows: [],
    view: { scrollX: 0, scrollY: 0, zoom: 1 },
    scene: [],
    background: { ...DEFAULT_BG },
    cwd,
  };
}

/** Last path segment of a folder (drives a workspace's auto name from its cwd). */
export function baseName(p?: string): string | undefined {
  if (!p) return undefined;
  const trimmed = p.replace(/[\\/]+$/, "");
  if (!trimmed) return undefined;
  const seg = trimmed.split(/[\\/]/).pop();
  return seg && seg.length ? seg : trimmed; // e.g. drive root "C:" keeps "C:"
}

const maxZ = (w: Workspace) => w.windows.reduce((m, win) => Math.max(m, win.z), 0);

/** Re-tile every window in a workspace into the grid (order-driven mosaic). */
function retile(w: Workspace): Workspace {
  if (!w.windows.length) return w;
  const tiles = computeTiles(w.windows.length);
  return {
    ...w,
    windows: w.windows.map((win, i) => ({ ...win, ...tiles[i] })),
  };
}

export interface AppState {
  workspaces: Workspace[];
  activeId: string;
  fullscreenId: string | null;
  /**
   * Focus mode of the ACTIVE workspace: a transient (non-persisted) toggle.
   * OFF = windows float freely at their stored x/y (like drawings); ON = they
   * gather into a tidy 1:1 grid (display-only, the stored x/y are untouched) and
   * tuck *behind* the drawings. Mirrors `focusByWorkspace[activeId]` so the rest
   * of the app can keep reading a single boolean.
   */
  focusMode: boolean;
  /** Per-workspace focus state (transient). Each space keeps its own toggle. */
  focusByWorkspace: Record<string, boolean>;
  /** The "new workspace" folder-picker dialog is open (transient). */
  newWorkspaceOpen: boolean;
  showGrid: boolean;
  showSettings: boolean;
  settingsSection: string;
  lastActiveTerminalId: string | null;
  settings: AppSettings;
  /** The startup "resume previous agents?" prompt has been answered/dismissed. */
  resumeDismissed: boolean;

  // settings
  toggleSettings: (v?: boolean) => void;
  openSettings: (section?: string) => void;
  setCliPreset: (cli: CliId, presetId: string, on: boolean) => void;
  setCliExtraArgs: (cli: CliId, args: string) => void;
  setShortcut: (actionId: string, combo: string) => void;
  resetShortcuts: () => void;
  setStt: (patch: Partial<SttSettings>) => void;

  // workspaces
  addWorkspace: (opts?: { cwd?: string; name?: string }) => string;
  removeWorkspace: (id: string) => void;
  openNewWorkspace: () => void;
  closeNewWorkspace: () => void;
  setActive: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setBackground: (id: string, bg: Background) => void;
  setWorkspaceCwd: (id: string, cwd: string) => void;
  saveView: (id: string, v: View) => void;
  saveScene: (id: string, scene: any[]) => void;

  // windows
  addTerminal: (cli: CliId, opts?: { cwd?: string }) => string;
  addPane: (kind: Exclude<PaneKind, "terminal">, opts?: Partial<WindowItem>) => string;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, patch: Partial<WindowItem>) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number, x?: number, y?: number) => void;
  reorderWindows: (idsInOrder: string[]) => void;
  bringToFront: (id: string) => void;
  setStatus: (id: string, status: AgentStatus) => void;
  setFullscreen: (id: string | null) => void;
  setLastActiveTerminal: (id: string) => void;
  toggleGrid: (v?: boolean) => void;
  setFocusMode: (v?: boolean) => void;
  tileActive: () => void;

  // conversation resume (across app restarts)
  resumeAllAgents: () => void;
  restartAgentsFresh: () => void;
  dismissResume: () => void;
}

/** Count agent panes (any workspace) that carry a resumable conversation. */
export const countResumableAgents = (s: AppState): number =>
  s.workspaces.reduce(
    (n, w) => n + w.windows.filter((win) => win.kind === "terminal" && win.resumable).length,
    0,
  );

/** Apply a patch to every resumable agent pane across all workspaces. */
function mapResumableAgents(
  s: AppState,
  patch: (win: WindowItem) => WindowItem,
): Pick<AppState, "workspaces"> {
  return {
    workspaces: s.workspaces.map((w) => ({
      ...w,
      windows: w.windows.map((win) =>
        win.kind === "terminal" && win.resumable ? patch(win) : win,
      ),
    })),
  };
}

function mapActive(s: AppState, fn: (w: Workspace) => Workspace) {
  return { workspaces: s.workspaces.map((w) => (w.id === s.activeId ? fn(w) : w)) };
}

const mapWindow = (w: Workspace, id: string, patch: (win: WindowItem) => WindowItem): Workspace => ({
  ...w,
  windows: w.windows.map((win) => (win.id === id ? patch(win) : win)),
});

const initial = makeWorkspace("main");

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      workspaces: [initial],
      activeId: initial.id,
      fullscreenId: null,
      focusMode: false,
      focusByWorkspace: {},
      newWorkspaceOpen: false,
      showGrid: false,
      showSettings: false,
      settingsSection: "agents",
      lastActiveTerminalId: null,
      settings: DEFAULT_SETTINGS,
      resumeDismissed: false,

      toggleSettings: (v) => set((s) => ({ showSettings: v ?? !s.showSettings })),

      openSettings: (section) =>
        set((s) => ({ showSettings: true, settingsSection: section ?? s.settingsSection })),

      setCliPreset: (cli, presetId, on) =>
        set((s) => {
          const cur = s.settings.cli[cli] ?? { presets: {}, extraArgs: "" };
          return {
            settings: {
              ...s.settings,
              cli: { ...s.settings.cli, [cli]: { ...cur, presets: { ...cur.presets, [presetId]: on } } },
            },
          };
        }),

      setCliExtraArgs: (cli, args) =>
        set((s) => {
          const cur = s.settings.cli[cli] ?? { presets: {}, extraArgs: "" };
          return {
            settings: {
              ...s.settings,
              cli: { ...s.settings.cli, [cli]: { ...cur, extraArgs: args } },
            },
          };
        }),

      setShortcut: (actionId, combo) =>
        set((s) => ({
          settings: { ...s.settings, shortcuts: { ...s.settings.shortcuts, [actionId]: combo } },
        })),

      resetShortcuts: () =>
        set((s) => ({ settings: { ...s.settings, shortcuts: { ...DEFAULT_SHORTCUTS } } })),

      setStt: (patch) =>
        set((s) => ({ settings: { ...s.settings, stt: { ...s.settings.stt, ...patch } } })),

      addWorkspace: (opts) => {
        const ws = makeWorkspace(
          opts?.name ?? baseName(opts?.cwd),
          opts?.cwd ?? undefined,
        );
        // Fall back to a numbered name only when nothing was derivable.
        set((s) => ({
          workspaces: [
            ...s.workspaces,
            opts?.name || opts?.cwd ? ws : { ...ws, name: String(s.workspaces.length + 1) },
          ],
          activeId: ws.id,
          showGrid: false,
          newWorkspaceOpen: false,
          // A brand-new space always starts OUT of focus, regardless of the
          // space you were in (each space owns its own focus toggle).
          focusMode: false,
          focusByWorkspace: { ...s.focusByWorkspace, [ws.id]: false },
        }));
        return ws.id;
      },

      removeWorkspace: (id) =>
        set((s) => {
          if (s.workspaces.length <= 1) return s;
          const remaining = s.workspaces.filter((w) => w.id !== id);
          void deleteSceneFiles(id); // drop the workspace's stored image binaries
          const activeId = s.activeId === id ? remaining[0].id : s.activeId;
          const { [id]: _dropped, ...focusByWorkspace } = s.focusByWorkspace;
          return {
            workspaces: remaining,
            activeId,
            focusByWorkspace,
            focusMode: focusByWorkspace[activeId] ?? false,
          };
        }),

      openNewWorkspace: () => set({ newWorkspaceOpen: true }),
      closeNewWorkspace: () => set({ newWorkspaceOpen: false }),

      setActive: (id) =>
        set((s) => ({ activeId: id, showGrid: false, focusMode: s.focusByWorkspace[id] ?? false })),

      renameWorkspace: (id, name) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })),

      setBackground: (id, bg) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, background: bg } : w)) })),

      setWorkspaceCwd: (id, cwd) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, cwd } : w)) })),

      saveView: (id, v) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, view: v } : w)) })),

      saveScene: (id, scene) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, scene } : w)) })),

      addTerminal: (cli, opts) => {
        const id = crypto.randomUUID();
        set((s) =>
          mapActive(s, (w) => {
            const used = new Set(w.windows.filter((x) => x.kind === "terminal").map((x) => x.title));
            const width = 600;
            const height = 440;
            const pos = spawnRectNear(width, height, w.windows);
            const win: WindowItem = {
              id,
              kind: "terminal",
              title: randomName(used),
              x: pos.x,
              y: pos.y,
              width,
              height,
              z: maxZ(w) + 1,
              cli,
              cwd: opts?.cwd ?? w.cwd,
              status: "idle",
              started: false,
              autostart: true,
              // Claude owns its conversation id (forced via --session-id on first
              // launch); other CLIs discover it after launch.
              sessionId: cli === "claude" ? crypto.randomUUID() : undefined,
              resumable: false,
            };
            return { ...w, windows: [...w.windows, win] };
          }),
        );
        return id;
      },

      addPane: (kind, opts) => {
        const id = crypto.randomUUID();
        set((s) =>
          mapActive(s, (w) => {
            const width = 760;
            const height = 540;
            const pos = spawnRectNear(width, height, w.windows);
            const win: WindowItem = {
              id,
              kind,
              title: "Browser",
              x: pos.x,
              y: pos.y,
              width,
              height,
              z: maxZ(w) + 1,
              url: opts?.url ?? "http://localhost:5173",
              ...opts,
            };
            return { ...w, windows: [...w.windows, win] };
          }),
        );
        return id;
      },

      removeWindow: (id) =>
        set((s) => ({
          ...mapActive(s, (w) => ({ ...w, windows: w.windows.filter((win) => win.id !== id) })),
          fullscreenId: s.fullscreenId === id ? null : s.fullscreenId,
          lastActiveTerminalId: s.lastActiveTerminalId === id ? null : s.lastActiveTerminalId,
        })),

      updateWindow: (id, patch) =>
        set((s) => mapActive(s, (w) => mapWindow(w, id, (win) => ({ ...win, ...patch })))),

      moveWindow: (id, x, y) =>
        set((s) => mapActive(s, (w) => mapWindow(w, id, (win) => ({ ...win, x, y })))),

      resizeWindow: (id, width, height, x, y) =>
        set((s) =>
          mapActive(s, (w) =>
            mapWindow(w, id, (win) => ({ ...win, width, height, x: x ?? win.x, y: y ?? win.y })),
          ),
        ),

      reorderWindows: (idsInOrder) =>
        set((s) =>
          mapActive(s, (w) => {
            const byId = new Map(w.windows.map((win) => [win.id, win]));
            const ordered = idsInOrder
              .map((id) => byId.get(id))
              .filter((x): x is WindowItem => !!x);
            // Append any windows not present in the order list (safety).
            for (const win of w.windows) if (!idsInOrder.includes(win.id)) ordered.push(win);
            // The focus grid is display-only (assigned by array order in Canvas),
            // so reordering just changes the order — the stored free x/y are kept.
            return { ...w, windows: ordered };
          }),
        ),

      bringToFront: (id) =>
        set((s) =>
          mapActive(s, (w) => {
            const top = maxZ(w);
            const win = w.windows.find((x) => x.id === id);
            if (!win || win.z === top) return w;
            return mapWindow(w, id, (x) => ({ ...x, z: top + 1 }));
          }),
        ),

      setStatus: (id, status) =>
        set((s) => mapActive(s, (w) => mapWindow(w, id, (win) => ({ ...win, status })))),

      setFullscreen: (id) => set({ fullscreenId: id }),

      setLastActiveTerminal: (id) => set({ lastActiveTerminalId: id }),

      toggleGrid: (v) => set((s) => ({ showGrid: v ?? !s.showGrid })),

      setFocusMode: (v) =>
        set((s) => {
          const next = v ?? !s.focusMode;
          return {
            focusMode: next,
            focusByWorkspace: { ...s.focusByWorkspace, [s.activeId]: next },
          };
        }),

      tileActive: () => set((s) => mapActive(s, (w) => retile(w))),

      // "Tout reprendre": flag every resumable agent to auto-spawn; spawnNew then
      // relaunches each CLI in resume mode (buildSpawnArgs reads `resumable`).
      resumeAllAgents: () =>
        set((s) => ({
          ...mapResumableAgents(s, (win) => ({ ...win, autostart: true })),
          resumeDismissed: true,
        })),

      // "Démarrer à neuf": drop the saved conversations (new Claude id), then
      // auto-spawn fresh.
      restartAgentsFresh: () =>
        set((s) => ({
          ...mapResumableAgents(s, (win) => ({
            ...win,
            resumable: false,
            sessionId: win.cli === "claude" ? crypto.randomUUID() : undefined,
            autostart: true,
          })),
          resumeDismissed: true,
        })),

      dismissResume: () => set({ resumeDismissed: true }),
    }),
    {
      name: "vato-cnvs",
      version: 4,
      migrate: (persisted: any, version: number) => {
        // Pre-v2 shapes are incompatible — start fresh.
        if (!persisted || version < 2) {
          const ws = makeWorkspace("main");
          return { workspaces: [ws], activeId: ws.id, settings: DEFAULT_SETTINGS };
        }
        // v2 -> v3: windows are now COUPLED to the viewport (scene coords + zoom).
        // Old x/y came from the removed winPan/screen model, so reset each
        // workspace's viewport to 100% and re-tile its windows into valid scene
        // coords — preserving the windows themselves (terminals/sessions kept).
        let next = persisted;
        if (version < 3) {
          next = {
            ...next,
            workspaces: (next.workspaces ?? []).map((w: any) =>
              retile({ ...w, view: { scrollX: 0, scrollY: 0, zoom: 1 } }),
            ),
          };
        }
        // v3 -> v4: shortcut defaults are now platform-aware (Cmd on macOS). The
        // old Windows-style Ctrl bindings were persisted as if customized, so
        // reset them once to the host platform's defaults.
        if (version < 4) {
          next = {
            ...next,
            settings: { ...(next.settings ?? {}), shortcuts: { ...DEFAULT_SHORTCUTS } },
          };
        }
        return next;
      },
      // Never auto-respawn terminals on reload: strip live PTY state.
      partialize: (s) => ({
        activeId: s.activeId,
        settings: s.settings,
        workspaces: s.workspaces.map((w) => ({
          ...w,
          windows: w.windows.map((win) => ({
            ...win,
            autostart: false,
            started: false,
            status: "idle" as AgentStatus,
            runningCli: undefined,
          })),
        })),
      }),
      // Fill in any shortcut actions added since the state was saved.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const settings = p.settings ?? current.settings;
        return {
          ...current,
          ...p,
          settings: {
            cli: settings.cli ?? {},
            shortcuts: { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts ?? {}) },
            stt: { ...DEFAULT_STT, ...(settings.stt ?? {}) },
          },
        };
      },
    },
  ),
);

export const useActiveWorkspace = (): Workspace =>
  useStore((s) => s.workspaces.find((w) => w.id === s.activeId) ?? s.workspaces[0]);
