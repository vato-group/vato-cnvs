import { memo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { focusGridWindows, useStore } from "../store";
import type { AgentStatus, WindowItem } from "../types";
import { CLIS } from "../data/clis";
import { TerminalPane } from "../panes/TerminalPane";
import { BrowserPane } from "../panes/BrowserPane";
import { useDrag } from "../canvas/dragState";
import { useSelection } from "../canvas/selectionState";
import { useCanvasState } from "../canvas/canvasState";
import { nearestSlotIndex, reorderIds } from "../canvas/tiling";
import { humanizeCombo } from "../canvas/shortcuts";
import { useT } from "../i18n";
import { CloseIcon, GlobeIcon, MaximizeIcon, MinimizeIcon } from "../ui/icons";

function ringClass(status?: AgentStatus): string {
  switch (status) {
    case "active":
    case "starting":
      return "vato-ring-active";
    case "finished":
      return "vato-ring-finished";
    case "error":
      return "vato-ring-error";
    default:
      return "";
  }
}

function shortUrl(u?: string): string {
  if (!u) return "";
  try {
    return new URL(u).host || u;
  } catch {
    return u;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  win: WindowItem;
  rect: Rect;
  /** Live canvas zoom — the window scales with it in free mode (coupled). */
  zoom: number;
  focusMode: boolean;
  fullscreen: boolean;
  hidden: boolean;
  isDragged: boolean;
  animate: boolean;
}

function WindowFrameImpl({ win, rect, zoom, focusMode, fullscreen, hidden, isDragged, animate }: Props) {
  const t = useT();
  const bringToFront = useStore((s) => s.bringToFront);
  const removeWindow = useStore((s) => s.removeWindow);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const moveWindow = useStore((s) => s.moveWindow);
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const tip = (label: string, id: string) =>
    shortcuts[id] ? `${label} · ${humanizeCombo(shortcuts[id])}` : label;

  const selected = useSelection((s) => s.selectedIds.includes(win.id));

  const baseIds = useRef<string[]>([]);
  // Start positions of every window in a multi-selection at drag start (scene
  // coords) + the dragged window's own start, so a free drag moves the group.
  const groupStart = useRef<Map<string, { x: number; y: number }> | null>(null);
  const dragOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // True while the user is freely dragging this window (free mode) — kills the
  // position transition so it tracks the cursor instead of easing behind it.
  const [freeDragging, setFreeDragging] = useState(false);

  const isTerminal = win.kind === "terminal";
  // Prefer the agent detected running *inside* the pane over the spawn CLI,
  // so launching `claude` in a shell updates the icon/accent/label live.
  const cliId = isTerminal ? win.runningCli ?? win.cli : undefined;
  const cli = cliId ? CLIS[cliId] : null;

  const position = fullscreen ? { x: 0, y: 0 } : { x: rect.x, y: rect.y };
  const size = fullscreen
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: rect.width, height: rect.height };
  // Free mode: the overlay is scaled by `zoom`, so the window's coords/size are in
  // SCENE space and react-rnd must know the parent scale (drag math, position).
  // Focus + fullscreen render at fixed screen pixels (overlay identity) → scale 1.
  const scale = fullscreen || focusMode ? 1 : zoom;

  const onDragStart = () => {
    bringToFront(win.id);
    if (focusMode) {
      // Focus mode: dragging a titlebar reorders the grid (live preview).
      const s = useStore.getState();
      const ws = s.workspaces.find((w) => w.id === s.activeId);
      // Reorder against the SAME filtered set the grid lays out (focusGridWindows),
      // so slot count / indices match Canvas; filtered-out panes are hidden and
      // can't start a drag anyway.
      baseIds.current = ws ? focusGridWindows(ws).map((w) => w.id) : [win.id];
      useDrag.getState().begin(win.id, baseIds.current);
    } else {
      // Free mode: dragging moves the window to an arbitrary canvas position.
      setFreeDragging(true);
      // If this window is part of a multi-selection, snapshot the group's start
      // positions so onDrag can move them all by the same delta.
      const sel = useSelection.getState().selectedIds;
      if (sel.includes(win.id) && sel.length > 1) {
        const s = useStore.getState();
        const ws = s.workspaces.find((w) => w.id === s.activeId);
        const map = new Map<string, { x: number; y: number }>();
        for (const w of ws?.windows ?? []) if (sel.includes(w.id)) map.set(w.id, { x: w.x, y: w.y });
        groupStart.current = map;
        dragOrigin.current = { x: win.x, y: win.y };
      } else {
        groupStart.current = null;
      }
    }
  };

  const onDrag = (_e: any, d: { x: number; y: number }) => {
    if (focusMode) {
      const n = baseIds.current.length;
      if (n <= 1) return;
      // Use the displayed (grid-tile) size for the centre, not the stored free size.
      const cx = d.x + rect.width / 2;
      const cy = d.y + rect.height / 2;
      const idx = nearestSlotIndex(cx, cy, n);
      const ids = reorderIds(baseIds.current, win.id, idx);
      useDrag.getState().preview(ids, idx);
      return;
    }
    // Free mode group move: drag the other selected windows live (the dragged one
    // is positioned by react-rnd and committed on stop).
    const g = groupStart.current;
    if (!g) return;
    const dx = d.x - dragOrigin.current.x;
    const dy = d.y - dragOrigin.current.y;
    for (const [id, p] of g) {
      if (id === win.id) continue;
      moveWindow(id, p.x + dx, p.y + dy);
    }
  };

  const onDragStop = (_e: any, d: { x: number; y: number }) => {
    if (focusMode) {
      const { previewIds } = useDrag.getState();
      if (previewIds) useStore.getState().reorderWindows(previewIds);
      useDrag.getState().end();
    } else {
      setFreeDragging(false);
      const g = groupStart.current;
      if (g) {
        // Commit the whole multi-selection by the final delta (robust even if no
        // onDrag fired between start and stop).
        const dx = d.x - dragOrigin.current.x;
        const dy = d.y - dragOrigin.current.y;
        for (const [id, p] of g) moveWindow(id, p.x + dx, p.y + dy);
      } else {
        moveWindow(win.id, d.x, d.y);
      }
      groupStart.current = null;
    }
  };

  // Click-select with the Selection tool (free mode). Shift toggles; clicking an
  // unselected window replaces the set; clicking one already in the group keeps
  // the group so the following drag moves them all.
  const onMouseDownCapture = (e: React.MouseEvent) => {
    bringToFront(win.id);
    if (focusMode || useCanvasState.getState().activeTool !== "selection") return;
    const sel = useSelection.getState();
    if (e.shiftKey) sel.toggle(win.id);
    else if (!sel.selectedIds.includes(win.id)) sel.setSelected([win.id]);
  };

  return (
    <Rnd
      scale={scale}
      position={position}
      size={size}
      disableDragging={fullscreen}
      enableResizing={false}
      dragHandleClassName="vato-titlebar"
      cancel=".vato-no-drag"
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragStop={onDragStop}
      style={{
        zIndex: fullscreen ? 9999 : isDragged || freeDragging ? 9000 : win.z,
        display: hidden ? "none" : undefined,
        pointerEvents: "auto",
        transition: animate && !isDragged && !freeDragging ? "transform 0.16s ease" : "none",
      }}
      onMouseDownCapture={onMouseDownCapture}
    >
      <div
        className={`vato-window ${ringClass(isTerminal ? win.status : undefined)} ${isDragged ? "dragging" : ""} ${selected ? "selected" : ""}`}
        style={cli ? ({ ["--accent" as string]: cli.color } as React.CSSProperties) : undefined}
      >
        <div className="vato-titlebar">
          <span className="vato-tb-icon" style={cli ? { color: cli.color } : undefined}>
            {isTerminal && cli ? <cli.Icon size={16} /> : <GlobeIcon size={16} />}
          </span>
          <span className="vato-tb-title">{win.title}</span>
          {isTerminal && cli && <span className="vato-tb-sub">{cli.label}</span>}
          {win.kind === "browser" && <span className="vato-tb-sub">{shortUrl(win.url)}</span>}

          <div className="vato-tb-spacer" />

          {isTerminal && <span className={`vato-status-dot s-${win.status ?? "idle"}`} />}

          <button
            className="vato-tb-btn vato-no-drag"
            title={tip(fullscreen ? t("frame.exitFullscreen") : t("frame.fullscreen"), "window.fullscreen")}
            onClick={() => setFullscreen(fullscreen ? null : win.id)}
          >
            {fullscreen ? <MinimizeIcon size={15} /> : <MaximizeIcon size={15} />}
          </button>
          <button
            className="vato-tb-btn vato-no-drag vato-close"
            title={tip(t("common.close"), "window.close")}
            onClick={() => removeWindow(win.id)}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="vato-body allow-select">
          {win.kind === "terminal" && <TerminalPane win={win} />}
          {win.kind === "browser" && <BrowserPane win={win} />}
        </div>
      </div>
    </Rnd>
  );
}

export const WindowFrame = memo(WindowFrameImpl);
