import { useEffect } from "react";
import { useStore } from "../store";
import { toggleFocusMode, selectTool, type ToolType } from "./canvasState";
import type { CliId } from "../types";

export interface ActionDef {
  id: string;
  label: string;
  group: string;
}

export const ACTION_DEFS: ActionDef[] = [
  { id: "tool.selection", label: "Outil — Sélection", group: "Outils" },
  { id: "tool.hand", label: "Outil — Main (déplacer)", group: "Outils" },
  { id: "tool.rectangle", label: "Outil — Rectangle", group: "Outils" },
  { id: "tool.diamond", label: "Outil — Losange", group: "Outils" },
  { id: "tool.ellipse", label: "Outil — Cercle", group: "Outils" },
  { id: "tool.arrow", label: "Outil — Flèche", group: "Outils" },
  { id: "tool.line", label: "Outil — Ligne", group: "Outils" },
  { id: "tool.freedraw", label: "Outil — Dessin", group: "Outils" },
  { id: "tool.text", label: "Outil — Texte", group: "Outils" },
  { id: "tool.image", label: "Outil — Image", group: "Outils" },
  { id: "tool.eraser", label: "Outil — Gomme", group: "Outils" },
  { id: "agent.claude", label: "Nouvel agent — Claude Code", group: "Agents" },
  { id: "agent.codex", label: "Nouvel agent — Codex", group: "Agents" },
  { id: "agent.cursor", label: "Nouvel agent — Cursor", group: "Agents" },
  { id: "agent.opencode", label: "Nouvel agent — OpenCode", group: "Agents" },
  { id: "agent.shell", label: "Nouveau terminal — Shell", group: "Agents" },
  { id: "pane.browser", label: "Nouveau navigateur", group: "Disposition" },
  { id: "layout.tile", label: "Mode focus — grille / dispersé", group: "Disposition" },
  { id: "view.focus", label: "Mode focus — regrouper / disperser", group: "Disposition" },
  { id: "window.close", label: "Fermer la fenêtre active", group: "Fenêtre" },
  { id: "window.fullscreen", label: "Plein écran de la fenêtre active", group: "Fenêtre" },
  { id: "workspace.new", label: "Nouveau workspace", group: "Espaces" },
  { id: "workspace.next", label: "Workspace suivant", group: "Espaces" },
  { id: "workspace.prev", label: "Workspace précédent", group: "Espaces" },
  { id: "workspace.overview", label: "Vue d'ensemble des workspaces", group: "Espaces" },
  { id: "settings.open", label: "Ouvrir les réglages", group: "Application" },
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
  space: "Espace",
  escape: "Esc",
};

export function humanizeCombo(combo: string): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((p) => PRETTY[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
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
    case "workspace.new": return s.openNewWorkspace();
    case "workspace.overview": return s.toggleGrid();
    case "settings.open": return s.toggleSettings();
    case "workspace.next":
    case "workspace.prev": {
      const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
      const delta = actionId === "workspace.next" ? 1 : -1;
      const n = s.workspaces.length;
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
      // The settings modal owns the keyboard while open (incl. rebind capture).
      if (st.showSettings) return;

      const combo = comboFromEvent(e);
      if (!combo) return;
      const shortcuts = st.settings.shortcuts;
      const actionId = Object.keys(shortcuts).find((id) => shortcuts[id] === combo);
      if (!actionId) return;

      // Don't steal keystrokes from text fields (settings/url bar/Excalidraw text).
      if (actionId !== "settings.open" && isEditableTarget()) return;
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
