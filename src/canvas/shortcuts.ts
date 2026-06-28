import { useEffect } from "react";
import { useStore } from "../store";
import { bus } from "../lib/bus";
import { revealWindow } from "../lib/reveal";
import { gt } from "../i18n";
import type { WindowItem } from "../types";
import { setFocusMode, toggleFocusMode, selectTool, type ToolType } from "./canvasState";
import type { CliId, FocusFilter } from "../types";

/**
 * A bindable action. `group` is an i18n group key ("tools", "agents", …); the
 * human label is looked up at render time via `action.<id>` so the shortcuts
 * list follows the app language.
 */
export interface ActionDef {
  id: string;
  group: string;
}

export const ACTION_DEFS: ActionDef[] = [
  { id: "tool.selection", group: "tools" },
  { id: "tool.hand", group: "tools" },
  { id: "tool.rectangle", group: "tools" },
  { id: "tool.diamond", group: "tools" },
  { id: "tool.ellipse", group: "tools" },
  { id: "tool.arrow", group: "tools" },
  { id: "tool.line", group: "tools" },
  { id: "tool.freedraw", group: "tools" },
  { id: "tool.text", group: "tools" },
  { id: "tool.image", group: "tools" },
  { id: "tool.eraser", group: "tools" },
  { id: "agent.claude", group: "agents" },
  { id: "agent.codex", group: "agents" },
  { id: "agent.cursor", group: "agents" },
  { id: "agent.opencode", group: "agents" },
  { id: "agent.shell", group: "agents" },
  { id: "pane.browser", group: "layout" },
  { id: "layout.tile", group: "layout" },
  { id: "view.focus", group: "layout" },
  { id: "view.focusFilter", group: "layout" },
  { id: "window.close", group: "window" },
  { id: "window.fullscreen", group: "window" },
  { id: "workspace.new", group: "spaces" },
  { id: "workspace.next", group: "spaces" },
  { id: "workspace.prev", group: "spaces" },
  { id: "workspace.overview", group: "spaces" },
  { id: "control.open", group: "app" },
  { id: "attention.next", group: "app" },
  { id: "broadcast.open", group: "app" },
  { id: "settings.open", group: "app" },
  { id: "voice.mic", group: "voice" },
];

/** Serialize a keydown into a stable combo string, or null for a lone modifier. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey) parts.push("meta");
  let key = k.toLowerCase();
  if (key === " ") key = "space";
  parts.push(key);
  return parts.join("+");
}

const PRETTY: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Cmd",
  arrowright: "→",
  arrowleft: "←",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
};

export function humanizeCombo(combo: string): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((p) =>
      p === "space"
        ? gt("kbd.space")
        : PRETTY[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)),
    )
    .join(" ");
}

/**
 * Humanized current binding for an action, or "" when unbound. Reads the store
 * directly (non-reactive); callers that must re-render on a rebind should also
 * subscribe to `settings.shortcuts`.
 */
export function shortcutLabel(actionId: string): string {
  const combo = useStore.getState().settings.shortcuts[actionId];
  return combo ? humanizeCombo(combo) : "";
}

/** Append a binding to a tooltip, e.g. `Selection · Ctrl V`. */
export function withShortcut(label: string, actionId: string): string {
  const kbd = shortcutLabel(actionId);
  return kbd ? `${label} · ${kbd}` : label;
}

function spawnAgent(cli: CliId) {
  useStore.getState().addTerminal(cli);
}

/** Execute an action by id. */
export function runAction(actionId: string) {
  if (actionId.startsWith("tool.")) {
    return selectTool(actionId.slice(5) as ToolType);
  }
  const s = useStore.getState();
  switch (actionId) {
    case "agent.claude": return spawnAgent("claude");
    case "agent.codex": return spawnAgent("codex");
    case "agent.cursor": return spawnAgent("cursor");
    case "agent.opencode": return spawnAgent("opencode");
    case "agent.shell": return spawnAgent("shell");
    case "pane.browser": return void s.addPane("browser");
    // Both toggle focus mode: gather the windows into a crisp 1:1 grid (behind
    // the drawings), or release them back to their free positions.
    case "layout.tile": return toggleFocusMode();
    case "view.focus": return toggleFocusMode();
    // Cycle what the focus grid shows for the active space; enter focus if needed
    // so the effect is always visible (the topbar segmented control mirrors it).
    case "view.focusFilter": {
      const order: FocusFilter[] = ["all", "agents", "terminals"];
      const ws = s.workspaces.find((w) => w.id === s.activeId);
      const next = order[(order.indexOf(ws?.focusFilter ?? "all") + 1) % order.length];
      s.setFocusFilter(next);
      setFocusMode(true); // guarded: no-op when already in focus
      return;
    }
    case "workspace.new": return s.openNewWorkspace();
    case "workspace.overview": return s.toggleGrid();
    case "control.open": return s.toggleControlCenter();
    case "broadcast.open": return s.toggleBroadcast();
    // Jump to the next agent that wants you. Most urgent first (error → waiting →
    // done), then cycle past whichever pane you're currently in. revealWindow
    // switches workspace / focuses / warps the cursor and clears its flag.
    case "attention.next": {
      const wants = (w: WindowItem) =>
        w.kind === "terminal" && (w.status === "waiting" || w.status === "error");
      const list: WindowItem[] = [];
      for (const w of s.workspaces) for (const win of w.windows) if (wants(win)) list.push(win);
      if (!list.length) return;
      // Crashed agents first, then those parked on a prompt.
      list.sort((a, b) => (a.status === "error" ? 0 : 1) - (b.status === "error" ? 0 : 1));
      const idx = list.findIndex((w) => w.id === s.lastActiveTerminalId);
      const next = list[(idx + 1) % list.length];
      return revealWindow(next.id);
    }
    case "settings.open": return s.toggleSettings();
    // The mic lives in the VoiceBar component; signal it over the bus.
    case "voice.mic": return bus.emit("voice:toggle");
    case "workspace.next":
    case "workspace.prev": {
      const n = s.workspaces.length;
      if (!n) return;
      const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
      const delta = actionId === "workspace.next" ? 1 : -1;
      const next = s.workspaces[(idx + delta + n) % n];
      return s.setActive(next.id);
    }
    case "window.close": {
      if (s.fullscreenId) return s.setFullscreen(null);
      if (s.lastActiveTerminalId) return s.removeWindow(s.lastActiveTerminalId);
      return;
    }
    case "window.fullscreen": {
      if (s.fullscreenId) return s.setFullscreen(null);
      if (s.lastActiveTerminalId) return s.setFullscreen(s.lastActiveTerminalId);
      return;
    }
  }
}

/** True when keystrokes should reach an editable field instead of a shortcut. */
function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT") return true;
  // Allow shortcuts over xterm; block over other textareas (URL bar, settings, Excalidraw text).
  if (tag === "TEXTAREA") return !el.classList.contains("xterm-helper-textarea");
  if (el.isContentEditable) return true;
  return false;
}

/** Global keyboard-shortcut handler driven by the persisted bindings. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      // The settings modal AND the first-run onboarding own the keyboard while
      // open (incl. inline rebind capture) — never fire a canvas action there.
      // Exception: the onboarding's "practice" step deliberately re-enables them
      // so the user can try shortcuts for real on the live canvas.
      if (st.showSettings || (!st.onboardingDone && !st.onboardingPractice)) return;

      const combo = comboFromEvent(e);
      if (!combo) return;
      const shortcuts = st.settings.shortcuts;
      const actionId = Object.keys(shortcuts).find((id) => shortcuts[id] === combo);
      if (!actionId) return;

      // The control center owns the keyboard while open (its own search box + arrow/
      // enter navigation handle keys locally); only its toggle passes through so the
      // same shortcut closes it again.
      if (st.showControlCenter && actionId !== "control.open") return;
      // Same for the broadcast bar: it owns the keyboard (its textarea + Esc/Enter);
      // only its own toggle passes through so the shortcut closes it again.
      if (st.showBroadcast && actionId !== "broadcast.open") return;

      // Don't steal keystrokes from text fields (settings/url bar/Excalidraw text).
      // `settings.open`/`control.open` are exempt so their toggle still works while a
      // field (incl. the control center's search box) holds focus.
      if (actionId !== "settings.open" && actionId !== "control.open" && isEditableTarget()) return;
      // Tool single-keys must only act on the canvas, never while a pane is focused
      // (e.g. typing "r" in a terminal must reach the shell, not pick the rectangle).
      if (actionId.startsWith("tool.")) {
        const el = document.activeElement as HTMLElement | null;
        if (el && el.closest(".vato-window")) return;
      }
      // Capture phase + stopPropagation so our bindings reliably win over
      // Excalidraw's built-ins (e.g. Ctrl+G = "group", which was eating the
      // tile shortcut intermittently) and over xterm.
      e.preventDefault();
      e.stopPropagation();
      runAction(actionId);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  }, []);
}
